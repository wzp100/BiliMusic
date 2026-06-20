import { normalizeBiliImageUrl } from '@/services/media'
import type { Track } from '@/types'

export interface BiliHistoryCursor {
  max?: number
  viewAt?: number
  business?: string
}

export interface BiliHistoryPage {
  tracks: Track[]
  hasMore: boolean
  cursor: BiliHistoryCursor
}

interface BiliHistoryCache {
  pages?: Record<string, { ts: number; page: BiliHistoryPage }>
}

const BILI_HISTORY_CACHE_KEY = 'bilimusic_bili_history_cache_v1'
const BILI_HISTORY_CACHE_TTL_MS = 60 * 1000

function readBiliHistoryCache(): BiliHistoryCache {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(BILI_HISTORY_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeBiliHistoryCache(cache: BiliHistoryCache): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BILI_HISTORY_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存写入失败不影响历史记录读取。
  }
}

export function clearBiliHistoryCache(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(BILI_HISTORY_CACHE_KEY)
  } catch {
    // ignore
  }
}

function isFresh(ts?: number): boolean {
  return Boolean(ts && Date.now() - ts < BILI_HISTORY_CACHE_TTL_MS)
}

function historyCacheKey(cursor: BiliHistoryCursor, pageSize: number): string {
  return JSON.stringify({
    pageSize,
    max: cursor.max || 0,
    viewAt: cursor.viewAt || 0,
    business: cursor.business || '',
  })
}

async function isLoggedIn(): Promise<boolean> {
  try {
    const { getNavInfo } = await import('@/services/bilibiliApi')
    const data = await getNavInfo()
    return Boolean(data.isLogin && data.mid)
  } catch {
    return false
  }
}

export async function getBiliHistory(
  cursor: BiliHistoryCursor = {},
  pageSize = 30,
  options: { force?: boolean } = {},
): Promise<BiliHistoryPage> {
  const cache = readBiliHistoryCache()
  const key = historyCacheKey(cursor, pageSize)
  const cached = cache.pages?.[key]
  if (!options.force && cached && isFresh(cached.ts)) return cached.page

  if (!await isLoggedIn()) return { tracks: [], hasMore: false, cursor: {} }

  const { getHistoryCursor } = await import('@/services/bilibiliApi')
  const data = await getHistoryCursor({
    max: cursor.max,
    view_at: cursor.viewAt,
    business: cursor.business,
  }, pageSize)

  const tracks = (data.list || [])
    .filter((item) => item.history?.bvid && (!item.history.business || item.history.business === 'archive'))
    .map((item): Track => {
      const bvid = item.history?.bvid || ''
      return {
        id: `bili-history-${bvid}`,
        title: item.title || '未命名视频',
        artist: item.author_name || 'Bilibili 用户',
        coverUrl: normalizeBiliImageUrl(item.cover || ''),
        duration: item.duration || 0,
        videoUrl: `https://www.bilibili.com/video/${bvid}`,
        bvid,
        aid: item.history?.oid,
        cid: item.history?.cid,
        playCount: 0,
        isLiked: false,
      }
    })

  const page = {
    tracks,
    hasMore: tracks.length > 0 && Boolean(data.cursor?.max || data.cursor?.view_at),
    cursor: {
      max: data.cursor?.max,
      viewAt: data.cursor?.view_at,
      business: data.cursor?.business,
    },
  }
  cache.pages = { ...(cache.pages || {}), [key]: { ts: Date.now(), page } }
  writeBiliHistoryCache(cache)
  return page
}
