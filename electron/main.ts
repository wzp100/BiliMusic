import { app, BrowserWindow, Tray, ipcMain, nativeImage, net, protocol, screen, session, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath, pathToFileURL } from 'url'
import { registerBiliApiHandlers } from './biliApi'
import { registerLyricsApiHandlers } from './lyricsApi'
import { initUpdates, getActiveRendererRoot } from './updater'
import { registerWebdavHandlers } from './webdav'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isHarmonyOS = (process.platform as string) === 'openharmony'

// 生产环境用自定义 app:// 协议加载渲染层：file:// 下 ESM(type=module) 脚本会被
// Chromium 的 CORS 策略拦截（file:// 为不透明源）导致页面空白。自定义标准安全协议
// 提供合法 origin，模块脚本与相对资源即可正常加载。须在 app ready 之前注册。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// Chrome MCP 远程调试（开发时使用）
app.commandLine.appendSwitch('remote-debugging-port', '17689')
app.commandLine.appendSwitch('remote-allow-origins', '*')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// B站请求头处理
//
// 注意：Electron 每个 session 的 webRequest 事件只允许注册一个监听器，
// 重复调用 onBeforeSendHeaders 会覆盖之前的。因此资源 CDN 与 API 的请求头
// 处理必须合并在同一个监听器内，否则后注册的会让前者失效（音频 CDN 拿不到
// Referer → 403）。
function setupBiliHeaders() {
  // 覆盖 B站所有资源/接口域名（图片、音频 CDN、API、登录）
  const biliUrls = [
    'https://*.hdslb.com/*',
    'https://*.bilivideo.com/*',
    'https://*.bilivideo.cn/*',
    'https://*.akamaized.net/*',
    'https://*.bilibili.com/*',
  ]

  // 记录每个 API 请求的渲染进程真实 Origin，供 onHeadersReceived 回显。
  // credentials:'include' 模式下浏览器要求 ACAO 必须是具体 origin，不能为 '*'，
  // 否则跨域响应被拦（dev 的 http://localhost:5173 会触发，file:// 不会）。
  const reqOrigin = new Map<number, string>()

  // 请求发出前：注入 Referer + Origin（改写到 bilibili.com 绕过反爬）。
  // 音频/图片 CDN（bilivideo/hdslb）缺少 Referer 会返回 403。
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: biliUrls }, (details, callback) => {
    const headers = details.requestHeaders
    const origin = headers['Origin'] || headers['origin']
    // 记录渲染进程真实 origin，供 onHeadersReceived 回显；字幕 JSON 在 hdslb 域名，
    // credentials:'include' 时也必须返回具体 ACAO，不能使用 *。
    if (origin && /^(https?|app):\/\//.test(origin)) {
      reqOrigin.set(details.id, origin)
    }
    headers['Referer'] = 'https://www.bilibili.com'
    headers['Origin'] = 'https://www.bilibili.com'
    callback({ requestHeaders: headers })
  })

  // B站响应：写入 CORS 头，让渲染进程可读取 API 和官方字幕 JSON。
  session.defaultSession.webRequest.onHeadersReceived({ urls: biliUrls }, (details, callback) => {
    const respHeaders: Record<string, string[]> = {}
    if (details.responseHeaders) {
      for (const [key, value] of Object.entries(details.responseHeaders)) {
        if (!key.toLowerCase().startsWith('access-control-allow')) {
          respHeaders[key] = value as string[]
        }
      }
    }
    const origin = reqOrigin.get(details.id)
    reqOrigin.delete(details.id)
    // 回显渲染进程真实 origin（带 credentials 时不能用 '*'）；取不到时退回 '*'（file:// 场景）
    respHeaders['access-control-allow-origin'] = [origin || '*']
    respHeaders['access-control-allow-credentials'] = ['true']
    respHeaders['access-control-allow-methods'] = ['GET, POST, PUT, DELETE, OPTIONS']
    respHeaders['access-control-allow-headers'] = ['*']
    callback({ responseHeaders: respHeaders })
  })
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let trayWindow: BrowserWindow | null = null
let trayWindowReady = false
let pendingTrayShow: { x: number; y: number } | null = null
let isQuitting = false

type TrayCommand = 'toggle-play' | 'next' | 'prev' | 'show-window' | 'quit'

interface TrayPlayerState {
  hasTrack: boolean
  title: string
  artist: string
  albumTitle?: string
  coverUrl: string
  isPlaying: boolean
  queueLength: number
  theme: 'light' | 'dark'
}

let trayPlayerState: TrayPlayerState = {
  hasTrack: false,
  title: '未在播放',
  artist: '搜索并播放音乐',
  albumTitle: '',
  coverUrl: '',
  isPlaying: false,
  queueLength: 0,
  theme: 'dark',
}

let taskbarCoverUrl = ''
let taskbarCoverRequestId = 0

const pngCrcTable = new Uint32Array(256).map((_value, index) => {
  let c = index
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function pngCrc32(buffers: Buffer[]): number {
  let crc = 0xffffffff
  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  crc.writeUInt32BE(pngCrc32([typeBuffer, data]), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function rgba(r: number, g: number, b: number, a = 255) {
  return { r, g, b, a }
}

function createPngImage(width: number, height: number, pixels: Buffer) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rawRow = y * (width * 4 + 1)
    const pixelRow = y * width * 4
    raw[rawRow] = 0
    pixels.copy(raw, rawRow + 1, pixelRow, pixelRow + width * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function drawPixel(pixels: Buffer, size: number, x: number, y: number, color: ReturnType<typeof rgba>) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const offset = (y * size + x) * 4
  pixels[offset] = color.r
  pixels[offset + 1] = color.g
  pixels[offset + 2] = color.b
  pixels[offset + 3] = color.a
}

function drawRect(pixels: Buffer, size: number, x: number, y: number, width: number, height: number, color: ReturnType<typeof rgba>) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) drawPixel(pixels, size, col, row, color)
  }
}

function drawCircle(pixels: Buffer, size: number, cx: number, cy: number, radius: number, color: ReturnType<typeof rgba>) {
  const rr = radius * radius
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= rr) drawPixel(pixels, size, x, y, color)
    }
  }
}

function drawTriangle(
  pixels: Buffer,
  size: number,
  points: Array<{ x: number; y: number }>,
  color: ReturnType<typeof rgba>,
) {
  const [a, b, c] = points
  const minX = Math.floor(Math.min(a.x, b.x, c.x))
  const maxX = Math.ceil(Math.max(a.x, b.x, c.x))
  const minY = Math.floor(Math.min(a.y, b.y, c.y))
  const maxY = Math.ceil(Math.max(a.y, b.y, c.y))
  const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const w1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / area
      const w2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / area
      const w3 = 1 - w1 - w2
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) drawPixel(pixels, size, x, y, color)
    }
  }
}

function thumbarIcon(name: 'prev' | 'play' | 'pause' | 'next') {
  const size = 32
  const pixels = Buffer.alloc(size * size * 4)
  const white = rgba(255, 255, 255)
  drawCircle(pixels, size, 16, 16, 15, rgba(32, 33, 36))
  if (name === 'play') {
    drawTriangle(pixels, size, [{ x: 12, y: 9 }, { x: 12, y: 23 }, { x: 23, y: 16 }], white)
  } else if (name === 'pause') {
    drawRect(pixels, size, 10, 9, 5, 14, white)
    drawRect(pixels, size, 18, 9, 5, 14, white)
  } else if (name === 'prev') {
    drawRect(pixels, size, 8, 9, 3, 14, white)
    drawTriangle(pixels, size, [{ x: 23, y: 9 }, { x: 23, y: 23 }, { x: 12, y: 16 }], white)
  } else {
    drawRect(pixels, size, 21, 9, 3, 14, white)
    drawTriangle(pixels, size, [{ x: 9, y: 9 }, { x: 9, y: 23 }, { x: 20, y: 16 }], white)
  }
  const image = nativeImage.createFromBuffer(createPngImage(size, size, pixels))
  return image.isEmpty() ? loadAppIcon().resize({ width: size, height: size }) : image
}

function updateTaskbarThumbarButtons() {
  if (process.platform !== 'win32' || !mainWindow) return
  if (!trayPlayerState.hasTrack) {
    mainWindow.setThumbarButtons([])
    mainWindow.setThumbnailToolTip('BiliMusic')
    return
  }
  mainWindow.setThumbnailToolTip(`${trayPlayerState.title} - ${trayPlayerState.artist}`)
  mainWindow.setThumbarButtons([
    {
      tooltip: '上一首',
      icon: thumbarIcon('prev'),
      click: () => sendTrayCommand('prev'),
    },
    {
      tooltip: trayPlayerState.isPlaying ? '暂停' : '播放',
      icon: thumbarIcon(trayPlayerState.isPlaying ? 'pause' : 'play'),
      click: () => sendTrayCommand('toggle-play'),
    },
    {
      tooltip: '下一首',
      icon: thumbarIcon('next'),
      click: () => sendTrayCommand('next'),
    },
  ])
}

async function updateTaskbarCoverIcon() {
  if (process.platform !== 'win32' || !mainWindow) return
  const coverUrl = trayPlayerState.hasTrack ? trayPlayerState.coverUrl : ''
  if (coverUrl === taskbarCoverUrl) return
  taskbarCoverUrl = coverUrl
  const requestId = ++taskbarCoverRequestId

  if (!coverUrl) {
    mainWindow.setIcon(loadAppIcon())
    mainWindow.setOverlayIcon(null, 'BiliMusic')
    return
  }

  try {
    const response = await net.fetch(coverUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (requestId !== taskbarCoverRequestId || !mainWindow) return
    const cover = nativeImage.createFromBuffer(buffer)
    if (cover.isEmpty()) return
    const largeCover = cover.resize({ width: 256, height: 256 })
    mainWindow.setIcon(largeCover)
    mainWindow.setOverlayIcon(cover.resize({ width: 32, height: 32 }), trayPlayerState.albumTitle || trayPlayerState.title || 'BiliMusic')
  } catch {
    if (requestId === taskbarCoverRequestId && mainWindow) {
      mainWindow.setIcon(loadAppIcon())
      mainWindow.setOverlayIcon(null, 'BiliMusic')
    }
  }
}

function updateTaskbarPlayerControls() {
  updateTaskbarThumbarButtons()
  void updateTaskbarCoverIcon()
}

// 应用图标：dev 时从 electron 源目录加载，打包后从 dist-electron 同级加载（由 copy 脚本随构建复制）
function loadAppIcon(fileName = 'icon.png') {
  const iconPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../electron', fileName)
    : path.join(__dirname, fileName)
  return nativeImage.createFromPath(iconPath)
}

function createTrayIcon() {
  const trayIcon = isHarmonyOS ? loadAppIcon('tray.png') : loadAppIcon()
  // 托盘图标尺寸较小，缩放到 32px 以兼顾标准与高 DPI 显示
  return trayIcon.resize({ width: 32, height: 32 })
}

function persistentStoreFile() {
  return path.join(app.getPath('userData'), 'renderer-persistent-store.json')
}

function readPersistentStore(): Record<string, string> {
  try {
    const file = persistentStoreFile()
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function writePersistentStore(store: Record<string, string>) {
  try {
    const file = persistentStoreFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(store, null, 2))
  } catch {
    // Persistence failures should not block the renderer.
  }
}

function showMainWindow() {
  if (!mainWindow) createWindow()
  if (process.platform === 'darwin') app.dock?.show()
  mainWindow?.show()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
}

function updateTrayState() {
  tray?.setToolTip(trayPlayerState.hasTrack
    ? `${trayPlayerState.isPlaying ? '正在播放' : '已暂停'}: ${trayPlayerState.title}`
    : 'BiliMusic')
  trayWindow?.webContents.send('tray:state', trayPlayerState)
}

function getTrayHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    /* 深色为默认，body.light 切换为浅色，跟随 app 主题 */
    :root {
      --tray-menu-bg: linear-gradient(180deg, rgba(38, 38, 42, .94), rgba(18, 18, 20, .96)), rgba(24, 24, 26, .96);
      --tray-menu-border: rgba(255, 255, 255, .12);
      --tray-menu-shadow: 0 28px 80px rgba(0, 0, 0, .44), inset 0 1px rgba(255, 255, 255, .12);
      --tray-text: #f7f7f8;
      --tray-now-bg: rgba(255, 255, 255, .075);
      --tray-now-border: rgba(255, 255, 255, .08);
      --tray-cover-fallback: rgba(255, 255, 255, .62);
      --tray-meta-sub: rgba(255, 255, 255, .48);
      --tray-status: rgba(255, 255, 255, .44);
      --tray-btn-bg: rgba(255, 255, 255, .1);
      --tray-btn-bg-hover: rgba(255, 255, 255, .16);
      --tray-btn-text: #fff;
      --tray-actions-border: rgba(255, 255, 255, .1);
      --tray-row-text: rgba(255, 255, 255, .82);
      --tray-row-hover: rgba(255, 255, 255, .1);
      --tray-count: rgba(255, 255, 255, .38);
    }
    body.light {
      --tray-menu-bg: linear-gradient(180deg, rgba(252, 252, 253, .95), rgba(244, 245, 248, .97)), rgba(255, 255, 255, .96);
      --tray-menu-border: rgba(24, 25, 28, .1);
      --tray-menu-shadow: 0 28px 80px rgba(24, 25, 28, .18), inset 0 1px rgba(255, 255, 255, .9);
      --tray-text: #18191C;
      --tray-now-bg: rgba(24, 25, 28, .04);
      --tray-now-border: rgba(24, 25, 28, .07);
      --tray-cover-fallback: rgba(24, 25, 28, .5);
      --tray-meta-sub: rgba(24, 25, 28, .5);
      --tray-status: rgba(24, 25, 28, .5);
      --tray-btn-bg: rgba(24, 25, 28, .06);
      --tray-btn-bg-hover: rgba(24, 25, 28, .1);
      --tray-btn-text: #18191C;
      --tray-actions-border: rgba(24, 25, 28, .08);
      --tray-row-text: rgba(24, 25, 28, .82);
      --tray-row-hover: rgba(24, 25, 28, .06);
      --tray-count: rgba(24, 25, 28, .4);
    }
    * { box-sizing: border-box; user-select: none; }
    body {
      width: 330px;
      height: 292px;
      margin: 0;
      overflow: hidden;
      color: var(--tray-text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: transparent;
    }
    .menu {
      width: 100%;
      height: 100%;
      padding: 14px;
      border-radius: 22px;
      background: var(--tray-menu-bg);
      border: 1px solid var(--tray-menu-border);
      box-shadow: var(--tray-menu-shadow);
      backdrop-filter: blur(30px) saturate(160%);
    }
    .now {
      display: flex;
      gap: 12px;
      align-items: center;
      min-height: 76px;
      padding: 10px;
      border-radius: 16px;
      background: var(--tray-now-bg);
      border: 1px solid var(--tray-now-border);
    }
    .cover {
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      overflow: hidden;
      flex: 0 0 auto;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(255,55,95,.42), rgba(255,255,255,.08));
      box-shadow: 0 12px 30px rgba(0,0,0,.22);
    }
    .cover img { width: 100%; height: 100%; object-fit: cover; display: none; }
    .cover span { color: var(--tray-cover-fallback); font-size: 22px; }
    .meta { min-width: 0; flex: 1; }
    .meta strong, .meta small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta strong { font-size: 14px; line-height: 1.2; font-weight: 760; }
    .meta small { margin-top: 5px; color: var(--tray-meta-sub); font-size: 12px; font-weight: 560; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 12px 2px 10px;
      color: var(--tray-status);
      font-size: 11px;
      font-weight: 680;
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #8e8e93;
      box-shadow: 0 0 0 transparent;
    }
    .status.is-playing .dot {
      background: #30d158;
      box-shadow: 0 0 14px rgba(48,209,88,.65);
    }
    .controls {
      display: grid;
      grid-template-columns: 1fr 1.25fr 1fr;
      gap: 10px;
      padding: 0 4px 12px;
    }
    button {
      height: 42px;
      border: 0;
      border-radius: 999px;
      color: var(--tray-btn-text);
      background: var(--tray-btn-bg);
      cursor: pointer;
      font: 780 13px/1 system-ui, sans-serif;
      transition: transform .16s ease, background .16s ease, opacity .16s ease;
    }
    button:hover { background: var(--tray-btn-bg-hover); transform: translateY(-1px); }
    button:active { transform: scale(.96); }
    button:disabled { opacity: .42; cursor: default; transform: none; }
    .play {
      background: #ff375f;
      color: #fff;
      box-shadow: 0 14px 30px rgba(255,55,95,.26);
      font-size: 16px;
    }
    .play:hover { background: #ff375f; }
    .actions {
      display: grid;
      gap: 8px;
      border-top: 1px solid var(--tray-actions-border);
      padding-top: 12px;
    }
    .row {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 13px;
      text-align: left;
      border-radius: 12px;
      background: transparent;
      color: var(--tray-row-text);
    }
    .row:hover { background: var(--tray-row-hover); }
    .row.danger { color: #ff6961; }
    .count { color: var(--tray-count); font-size: 12px; }
  </style>
</head>
<body>
  <div class="menu">
    <div class="now">
      <div class="cover"><img id="cover" /><span id="fallback">♪</span></div>
      <div class="meta">
        <strong id="title">未在播放</strong>
        <small id="artist">搜索并播放音乐</small>
      </div>
    </div>
    <div id="status" class="status"><span class="dot"></span><span id="statusText">空闲</span></div>
    <div class="controls">
      <button id="prev" title="上一首">⏮</button>
      <button id="play" class="play" title="播放/暂停">▶</button>
      <button id="next" title="下一首">⏭</button>
    </div>
    <div class="actions">
      <button class="row" id="show"><span>显示 BiliMusic</span><span class="count" id="queue">0 首</span></button>
      <button class="row danger" id="quit"><span>退出应用</span><span>⌘Q</span></button>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron')
    const $ = (id) => document.getElementById(id)
    let state = { hasTrack: false, title: '未在播放', artist: '搜索并播放音乐', coverUrl: '', isPlaying: false, queueLength: 0, theme: 'dark' }
    function render(next) {
      state = next || state
      document.body.classList.toggle('light', (state.theme || 'dark') === 'light')
      $('title').textContent = state.title || '未在播放'
      $('artist').textContent = state.artist || '搜索并播放音乐'
      $('status').className = 'status' + (state.isPlaying ? ' is-playing' : '')
      $('statusText').textContent = state.hasTrack ? (state.isPlaying ? '正在播放' : '已暂停') : '空闲'
      $('play').textContent = state.isPlaying ? '⏸' : '▶'
      $('queue').textContent = (state.queueLength || 0) + ' 首'
      $('prev').disabled = $('play').disabled = $('next').disabled = !state.hasTrack
      if (state.coverUrl) {
        $('cover').src = state.coverUrl
        $('cover').style.display = 'block'
        $('fallback').style.display = 'none'
      } else {
        $('cover').removeAttribute('src')
        $('cover').style.display = 'none'
        $('fallback').style.display = 'block'
      }
    }
    ipcRenderer.on('tray:state', (_event, next) => render(next))
    ipcRenderer.invoke('tray:get-state').then(render)
    $('prev').onclick = () => ipcRenderer.send('tray:command', 'prev')
    $('play').onclick = () => ipcRenderer.send('tray:command', 'toggle-play')
    $('next').onclick = () => ipcRenderer.send('tray:command', 'next')
    $('show').onclick = () => ipcRenderer.send('tray:command', 'show-window')
    $('quit').onclick = () => ipcRenderer.send('tray:command', 'quit')
  </script>
</body>
</html>`
}

function createTrayWindow() {
  if (isHarmonyOS) return null
  if (trayWindow) return trayWindow
  trayWindowReady = false
  trayWindow = new BrowserWindow({
    width: 330,
    height: 292,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    opacity: 0,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  trayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getTrayHtml())}`)
  trayWindow.once('ready-to-show', () => {
    trayWindowReady = true
    if (pendingTrayShow) {
      const pos = pendingTrayShow
      pendingTrayShow = null
      showTrayWindowAt(pos.x, pos.y)
    }
  })
  trayWindow.on('blur', () => {
    trayWindow?.setOpacity(0)
    trayWindow?.hide()
  })
  trayWindow.on('closed', () => {
    trayWindow = null
    trayWindowReady = false
    pendingTrayShow = null
  })
  return trayWindow
}

function showTrayWindowAt(x: number, y: number) {
  const win = createTrayWindow()
  if (!win) return
  if (!trayWindowReady) {
    pendingTrayShow = { x, y }
    return
  }
  win.setPosition(x, y, false)
  updateTrayState()
  win.setOpacity(0)
  win.showInactive()
  setTimeout(() => {
    if (!trayWindow?.isVisible()) return
    trayWindow.setOpacity(1)
    trayWindow.focus()
  }, 20)
}

function toggleTrayWindow() {
  if (isHarmonyOS) return
  if (!tray) return
  const win = createTrayWindow()
  if (!win) return
  if (win.isVisible()) {
    win.setOpacity(0)
    win.hide()
    return
  }

  const bounds = tray.getBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const width = 330
  const height = 292
  const x = Math.round(Math.min(Math.max(bounds.x + bounds.width / 2 - width / 2, workArea.x + 8), workArea.x + workArea.width - width - 8))
  const aboveY = bounds.y - height - 10
  const belowY = bounds.y + bounds.height + 10
  const y = aboveY >= workArea.y ? aboveY : Math.min(belowY, workArea.y + workArea.height - height - 8)

  showTrayWindowAt(x, Math.round(y))
}

function createTray() {
  if (tray) return
  tray = new Tray(createTrayIcon())
  tray.setToolTip('BiliMusic')
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  if (!isHarmonyOS) {
    tray.on('right-click', toggleTrayWindow)
    createTrayWindow()
  }
}

function hideToTray() {
  if (mainWindow?.isFullScreen()) {
    mainWindow.setFullScreen(false)
    mainWindow.webContents.send('window:fullscreen-change', false)
    mainWindow.webContents.send('window:maximized-change', Boolean(mainWindow.isMaximized()))
  }
  mainWindow?.hide()
  if (process.platform === 'darwin') app.dock?.hide()
}

function runAfterLeavingFullscreen(action: () => void) {
  if (!mainWindow) return
  if (!mainWindow.isFullScreen()) {
    action()
    return
  }

  const targetWindow = mainWindow
  let didRun = false
  const runAction = () => {
    if (didRun) return
    didRun = true
    if (!targetWindow.isDestroyed()) action()
  }

  targetWindow.once('leave-full-screen', runAction)
  targetWindow.setFullScreen(false)
  targetWindow.webContents.send('window:fullscreen-change', false)
  targetWindow.webContents.send('window:maximized-change', Boolean(targetWindow.isMaximized()))
  setTimeout(() => {
    if (targetWindow.isDestroyed() || targetWindow.isFullScreen()) return
    targetWindow.removeListener('leave-full-screen', runAction)
    runAction()
  }, 220)
}

function sendTrayCommand(command: TrayCommand) {
  if (command === 'show-window') {
    showMainWindow()
    trayWindow?.hide()
    return
  }
  if (command === 'quit') {
    isQuitting = true
    trayWindow?.close()
    mainWindow?.destroy()
    app.quit()
    return
  }
  mainWindow?.webContents.send('tray:player-command', command)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'BiliMusic',
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    minimizable: true,
    maximizable: true,
    closable: true,
    ...(!isHarmonyOS ? { titleBarStyle: 'hidden' as const } : {}),
    backgroundColor: '#F6F7F9',
    icon: loadAppIcon(),
    webPreferences: {
      preload: process.env.VITE_DEV_SERVER_URL
        ? path.join(__dirname, '../electron/preload.cjs')
        : path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (process.env.BILIMUSIC_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadURL('app://local/index.html')
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideToTray()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const sendMaximizeState = () => {
    mainWindow?.webContents.send('window:maximized-change', Boolean(mainWindow?.isMaximized()))
  }
  const sendFullscreenState = () => {
    mainWindow?.webContents.send('window:fullscreen-change', Boolean(mainWindow?.isFullScreen()))
  }
  mainWindow.on('maximize', sendMaximizeState)
  mainWindow.on('unmaximize', sendMaximizeState)
  mainWindow.on('enter-full-screen', () => {
    sendMaximizeState()
    sendFullscreenState()
  })
  mainWindow.on('leave-full-screen', () => {
    sendMaximizeState()
    sendFullscreenState()
  })
}

// 窗口控制 IPC
ipcMain.on('window:maximize', () => {
  runAfterLeavingFullscreen(() => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
})
ipcMain.on('window:minimize', () => runAfterLeavingFullscreen(() => mainWindow?.minimize()))
ipcMain.on('window:close', () => runAfterLeavingFullscreen(hideToTray))
ipcMain.handle('window:isMaximized', () => Boolean(mainWindow?.isMaximized()))
ipcMain.on('window:toggle-fullscreen', () => {
  if (!mainWindow) return
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  mainWindow.webContents.send('window:fullscreen-change', next)
  mainWindow.webContents.send('window:maximized-change', Boolean(mainWindow.isMaximized()))
})
ipcMain.on('window:set-button-visibility', (_event, visible: boolean) => {
  if (!isHarmonyOS) return
  const next = Boolean(visible)
  const setWindowButtonVisibility = (mainWindow as unknown as {
    setWindowButtonVisibility?: (visible: boolean) => void
  } | null)?.setWindowButtonVisibility
  if (typeof setWindowButtonVisibility === 'function') {
    setWindowButtonVisibility.call(mainWindow, next)
  }
  mainWindow?.setTitle(`__BILIMUSIC_WINDOW_BUTTONS__:${next ? 'show' : 'hide'}`)
})
ipcMain.handle('window:isFullscreen', () => Boolean(mainWindow?.isFullScreen()))
ipcMain.on('tray:player-state', (_event, state: TrayPlayerState) => {
  trayPlayerState = {
    hasTrack: Boolean(state?.hasTrack),
    title: String(state?.title || '未在播放'),
    artist: String(state?.artist || '搜索并播放音乐'),
    albumTitle: String(state?.albumTitle || ''),
    coverUrl: String(state?.coverUrl || ''),
    isPlaying: Boolean(state?.isPlaying),
    queueLength: Number(state?.queueLength || 0),
    theme: state?.theme === 'light' ? 'light' : 'dark',
  }
  updateTrayState()
  updateTaskbarPlayerControls()
})
ipcMain.on('tray:command', (_event, command: TrayCommand) => sendTrayCommand(command))
ipcMain.handle('tray:get-state', () => trayPlayerState)
ipcMain.on('persistent-storage:get', (event, key: string) => {
  if (typeof key !== 'string') {
    event.returnValue = null
    return
  }
  event.returnValue = readPersistentStore()[key] ?? null
})
ipcMain.on('persistent-storage:set', (_event, key: string, value: string) => {
  if (typeof key !== 'string' || typeof value !== 'string') return
  const store = readPersistentStore()
  store[key] = value
  writePersistentStore(store)
})
ipcMain.on('persistent-storage:remove', (_event, key: string) => {
  if (typeof key !== 'string') return
  const store = readPersistentStore()
  delete store[key]
  writePersistentStore(store)
})
// 用系统默认浏览器打开外部链接（仅放行 http/https，避免任意协议执行）
ipcMain.handle('shell:open-external', (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
})

app.whenReady().then(() => {
  // 生产环境注册 app:// 协议，映射到打包后的 dist 目录（asar 内 file:// 读取透明支持）
  if (!process.env.VITE_DEV_SERVER_URL) {
    protocol.handle('app', async (request) => {
      const { pathname } = new URL(request.url)
      // 渲染层根目录可能是包内 dist 或已生效的 OTA asar（net.fetch 透明读 asar 内部）
      const filePath = path.join(getActiveRendererRoot(), decodeURIComponent(pathname))
      try {
        return await net.fetch(pathToFileURL(filePath).toString())
      } catch (err) {
        // 关键诊断：鸿蒙上若读沙箱 asar 失败会在此命中（filePath 含 .asar）
        console.log('[BiliMusic-OTA] app:// fetch FAILED:', filePath, '—', err instanceof Error ? err.message : String(err))
        throw err
      }
    })
  }
  setupBiliHeaders()
  registerBiliApiHandlers()
  registerLyricsApiHandlers()
  registerWebdavHandlers()
  // 更新模块须在创建窗口前初始化：bootReconcile 先定下生效的渲染层根目录，供 app:// 加载
  initUpdates({
    window: () => mainWindow,
    bundledRendererRoot: path.join(__dirname, '../dist'),
    reload: () => {
      mainWindow?.loadURL('app://local/index.html')
    },
  })
  if (isHarmonyOS) {
    // OpenHarmony 上窗口显示/隐藏与托盘强相关，需先创建托盘再创建主窗口。
    createTray()
    createWindow()
  } else {
    createWindow()
    createTray()
  }
})

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
  else showMainWindow()
})
