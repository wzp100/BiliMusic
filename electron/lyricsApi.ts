import { ipcMain, net } from 'electron'

/**
 * 歌词服务层（LRCLIB）
 *
 * 为什么走主进程 net.fetch 而非渲染进程 fetch：
 * - 渲染进程 fetch 受 CORS 限制（dev 源 localhost:5173 / prod 源 file://），
 *   LRCLIB 不回 CORS 头会被拦；net.fetch 是 Node 侧请求，无 CORS。
 * - 还能设置 User-Agent / Lrclib-Client（浏览器 fetch 禁止改 UA）。
 *
 * 本层保持极薄：只做 LRCLIB 取数，清洗/排序/解析/缓存全部在渲染层
 * （src/services/lyrics.ts），便于单测与迭代。
 */

const LRCLIB = 'https://lrclib.net'
const LRC_HEADERS = {
  'User-Agent': 'biliMusic/1.0.0 (https://github.com/Hanversion/biliMusic)',
  'Lrclib-Client': 'biliMusic v1.0.0',
}

export interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export interface LyricsSearchQuery {
  q?: string
  trackName?: string
  artistName?: string
}

export function registerLyricsApiHandlers() {
  // 搜索 → 候选列表（每条已含 synced/plain 歌词，无需二次请求）
  // 支持自由文本 q，或结构化 trackName/artistName。
  ipcMain.handle('lyrics:search', async (_event, query: LyricsSearchQuery): Promise<LrclibRecord[]> => {
    const usp = new URLSearchParams()
    if (query.q) usp.set('q', query.q)
    if (query.trackName) usp.set('track_name', query.trackName)
    if (query.artistName) usp.set('artist_name', query.artistName)
    if (![...usp.keys()].length) return []

    // LRCLIB 对未命中查询响应较慢，加超时避免卡死
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const resp = await net.fetch(`${LRCLIB}/api/search?${usp.toString()}`, { headers: LRC_HEADERS, signal: ctrl.signal })
      if (!resp.ok) return []
      const data = await resp.json()
      return Array.isArray(data) ? (data as LrclibRecord[]) : []
    } catch {
      return []
    } finally {
      clearTimeout(timer)
    }
  })
}
