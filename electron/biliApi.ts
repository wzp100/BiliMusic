import { ipcMain, net, app, session } from 'electron'
import path from 'path'
import fs from 'fs/promises'

const BILI_API = 'https://api.bilibili.com'
const BILI_PASSPORT = 'https://passport.bilibili.com'
const BILI_REFERER = 'https://www.bilibili.com'

// ===== IPC Handlers =====

export function registerBiliApiHandlers() {
  // 搜索视频
  ipcMain.handle('bili:search', async (_event, keyword: string, page = 1, pageSize = 20) => {
    return fetchBiliApi(`/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}`)
  })

  // 视频详情
  ipcMain.handle('bili:videoDetail', async (_event, bvid: string) => {
    return fetchBiliApi(`/x/web-interface/view?bvid=${bvid}`)
  })

  // 音频流地址
  ipcMain.handle('bili:playUrl', async (_event, bvid: string, cid: number) => {
    return fetchBiliApi(`/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=0&fnver=0&fnval=16&fourk=1`)
  })

  // 用户信息（登录状态）
  ipcMain.handle('bili:nav', async () => {
    return fetchBiliApi('/x/web-interface/nav')
  })

  // 热门视频
  ipcMain.handle('bili:popular', async (_event, ps = 10, pn = 1) => {
    return fetchBiliApi(`/x/web-interface/popular?ps=${ps}&pn=${pn}`)
  })

  // 推荐视频
  ipcMain.handle('bili:recommend', async (_event, ps = 10) => {
    return fetchBiliApi(`/x/web-interface/index/top/rcmd?ps=${ps}`)
  })

  // 收藏夹列表
  ipcMain.handle('bili:favorites', async (_event, mid: number) => {
    return fetchBiliApi(`/x/v3/fav/folder/created/list-all?up_mid=${mid}`)
  })

  // 添加视频到收藏夹
  ipcMain.handle('bili:favoriteResourceDeal', async (_event, rid: number, mediaId: number) => {
    if (!Number.isFinite(rid) || !Number.isFinite(mediaId)) {
      throw createBiliError(-1, '收藏参数无效', 'bili:favoriteResourceDeal')
    }
    const cookies = await session.defaultSession.cookies.get({ url: BILI_API })
    const biliJct = cookies.find(c => c.name === 'bili_jct')?.value || ''
    if (!biliJct) throw createBiliError(-101, '需要先登录 Bilibili', 'bili:favoriteResourceDeal')
    return postBiliApi('/x/v3/fav/resource/deal', {
      rid: String(rid),
      type: '2',
      add_media_ids: String(mediaId),
      del_media_ids: '',
      csrf: biliJct,
    })
  })

  // 下载音频文件到本地
  ipcMain.handle('bili:downloadAudio', async (_event, audioUrl: string, filename: string) => {
    const downloadDir = path.join(app.getPath('userData'), 'downloads')
    await fs.mkdir(downloadDir, { recursive: true })
    const filePath = path.join(downloadDir, filename)

    const response = await net.fetch(audioUrl, {
      headers: { Referer: BILI_REFERER },
    })

    if (!response.ok) throw new Error(`Download failed: ${response.status}`)

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(filePath, buffer)

    return { filePath, size: buffer.length }
  })

  // 提取完整音频源（一键流程）
  ipcMain.handle('bili:extractAudio', async (_event, bvid: string) => {
    const detail = await fetchBiliApi(`/x/web-interface/view?bvid=${bvid}`)
    const playData = await fetchBiliApi(`/x/player/playurl?bvid=${bvid}&cid=${detail.cid}&qn=0&fnver=0&fnval=16&fourk=1`)

    const audioStreams = playData.dash?.audio || []
    if (!audioStreams.length) throw new Error('No audio stream available')

    const bestAudio = [...audioStreams].sort((a, b) => b.bandwidth - a.bandwidth)[0]

    return {
      bvid: detail.bvid,
      aid: detail.aid,
      cid: detail.cid,
      title: detail.title,
      artist: detail.owner?.name,
      coverUrl: detail.pic,
      duration: detail.duration,
      audioUrl: bestAudio.baseUrl,
      audioQuality: bestAudio.quality,
      audioMimeType: bestAudio.mimeType,
      bandwidth: bestAudio.bandwidth,
    }
  })

  // ===== 扫码登录 =====

  // 生成二维码
  ipcMain.handle('bili:qrGenerate', async () => {
    const url = `${BILI_PASSPORT}/x/passport-login/web/qrcode/generate`
    const response = await net.fetch(url, {
      headers: { Referer: `${BILI_PASSPORT}/login` },
    })
    const data = await response.json()

    if (data.code !== 0) {
      throw createBiliError(data.code, data.message, 'bili:qrGenerate')
    }

    return {
      url: data.data.url,
      qrcodeKey: data.data.qrcode_key,
    }
  })

  // 轮询二维码状态
  ipcMain.handle('bili:qrPoll', async (_event, qrcodeKey: string) => {
    const url = `${BILI_PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${qrcodeKey}`
    const response = await net.fetch(url, {
      headers: { Referer: `${BILI_PASSPORT}/login` },
      redirect: 'manual',
    })

    const httpStatus = response.status
    const setCookieHeaders = response.headers.getSetCookie?.() || []
    const isRedirect = httpStatus === 302 || httpStatus === 301

    if (isRedirect && setCookieHeaders.length > 0) {
      for (const cookieStr of setCookieHeaders) {
        try {
          await session.defaultSession.cookies.set({
            url: BILI_API,
            name: parseCookieName(cookieStr),
            value: parseCookieValue(cookieStr),
            domain: '.bilibili.com',
            path: '/',
            secure: true,
            httpOnly: true,
          })
        } catch {
        }
      }
      return {
        code: 0,
        status: 0,
        message: '登录成功',
        url: response.headers.get('Location') || '',
      }
    }

    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return { code: -1, status: -1, message: 'unknown', url: '' }
    }

    // B站 poll 响应：外层 code 表示 API 调用结果，
    // 内层 data.code 才是扫码状态（86101=未扫码, 86090=已扫码, 0=成功）
    return {
      code: data.data?.code ?? data.code,
      status: data.data?.code ?? data.code,
      message: data.data?.message || data.message,
      url: data.data?.url || '',
    }
  })

  // 获取当前 Cookie 中的登录状态
  ipcMain.handle('bili:getCookies', async () => {
    const cookies = await session.defaultSession.cookies.get({ domain: '.bilibili.com' })
    const sessdata = cookies.find(c => c.name === 'SESSDATA')
    const biliJct = cookies.find(c => c.name === 'bili_jct')
    const dedeUserId = cookies.find(c => c.name === 'DedeUserID')

    return {
      isLoggedIn: !!(sessdata && biliJct && dedeUserId),
      sessdata: sessdata?.value || '',
      biliJct: biliJct?.value || '',
      dedeUserId: dedeUserId?.value || '',
    }
  })

  // 退出登录（清除 Cookie）
  ipcMain.handle('bili:logout', async () => {
    await session.defaultSession.cookies.remove(BILI_API, 'SESSDATA')
    await session.defaultSession.cookies.remove(BILI_API, 'bili_jct')
    await session.defaultSession.cookies.remove(BILI_API, 'DedeUserID')
    await session.defaultSession.cookies.remove(BILI_API, 'DedeUserID__ckMd5')
    return { success: true }
  })
}

// ===== BiliBili API Fetch Helper =====

async function fetchBiliApi(urlPath: string): Promise<any> {
  const url = `${BILI_API}${urlPath}`
  // 从 session 中获取 Cookie，确保 API 请求携带登录态
  const cookies = await session.defaultSession.cookies.get({ url: BILI_API })
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const headers: Record<string, string> = {
    Referer: BILI_REFERER,
    Origin: 'https://www.bilibili.com',
  }
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader
  }

  const response = await net.fetch(url, { headers })
  const data = await response.json()

  if (data.code !== 0) {
    throw createBiliError(data.code, data.message, urlPath)
  }

  return data.data
}

// ===== Cookie 解析辅助 =====

function parseCookieName(setCookie: string): string {
  const pair = setCookie.split(';')[0]
  return pair.split('=')[0].trim()
}

function parseCookieValue(setCookie: string): string {
  const pair = setCookie.split(';')[0]
  return pair.split('=').slice(1).join('=').trim()
}

async function postBiliApi(urlPath: string, body: Record<string, string>): Promise<any> {
  const url = `${BILI_API}${urlPath}`
  const cookies = await session.defaultSession.cookies.get({ url: BILI_API })
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const form = new URLSearchParams(body)

  const headers: Record<string, string> = {
    Referer: BILI_REFERER,
    Origin: 'https://www.bilibili.com',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  }
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader
  }

  const response = await net.fetch(url, {
    method: 'POST',
    headers,
    body: form.toString(),
  })
  const data = await response.json()

  if (data.code !== 0) {
    throw createBiliError(data.code, data.message, urlPath)
  }

  return data.data
}

function createBiliError(code: number, message: string, path?: string): Error & { code?: number; path?: string } {
  const error = new Error(message || `Bilibili API error: ${code}`) as Error & { code?: number; path?: string }
  error.code = code
  if (path) error.path = path
  return error
}
