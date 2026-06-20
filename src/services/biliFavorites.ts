import { normalizeBiliImageUrl } from '@/services/media'
import type { Track } from '@/types'

export interface BiliFavoriteFolder {
  id: number
  title: string
  mediaCount: number
  coverUrl: string
  description: string
  updatedAt?: number
}

interface BiliFavoriteFolderPage {
  info?: BiliFavoriteFolder
  tracks: Track[]
  hasMore: boolean
}

interface BiliFavoriteCache {
  currentUser?: { ts: number; mid: number }
  folders?: Record<string, { ts: number; items: BiliFavoriteFolder[] }>
  tracks?: Record<string, { ts: number; page: BiliFavoriteFolderPage }>
}

const BILI_FAVORITE_CACHE_KEY = 'bilimusic_bili_favorite_cache_v1'
export const BILI_FAVORITE_CACHE_TTL_MS = 60 * 1000

function readBiliFavoriteCache(): BiliFavoriteCache {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(BILI_FAVORITE_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeBiliFavoriteCache(cache: BiliFavoriteCache): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BILI_FAVORITE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存写入失败不影响播放和收藏夹读取。
  }
}

export function clearBiliFavoriteCache(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(BILI_FAVORITE_CACHE_KEY)
  } catch {
    // ignore
  }
}

function isFresh(ts?: number): boolean {
  return Boolean(ts && Date.now() - ts < BILI_FAVORITE_CACHE_TTL_MS)
}

function folderCacheKey(mid?: number): string {
  return String(mid || 'self')
}

function trackCacheKey(mediaId: number, page: number, pageSize: number): string {
  return `${mediaId}:${page}:${pageSize}`
}

function getCachedBiliFavoriteFolderCover(mediaId: number): string {
  const cache = readBiliFavoriteCache()
  const pages = Object.entries(cache.tracks || {})
    .filter(([key]) => key.startsWith(`${mediaId}:`))
    .map(([, entry]) => entry.page)
  for (const page of pages) {
    const cover = page.info?.coverUrl || page.tracks.find((track) => track.coverUrl)?.coverUrl || ''
    if (cover) return cover
  }
  return ''
}

async function getCurrentMid(force = false): Promise<number> {
  const cache = readBiliFavoriteCache()
  if (!force && cache.currentUser?.mid && isFresh(cache.currentUser.ts)) return cache.currentUser.mid

  const { getNavInfo } = await import('@/services/bilibiliApi')
  const data = await getNavInfo()
  const mid = data.mid || 0
  if (mid > 0) writeBiliFavoriteCache({ ...cache, currentUser: { ts: Date.now(), mid } })
  return mid
}

export async function getBiliFavoriteFolders(
  mid?: number,
  options: { force?: boolean } = {},
): Promise<BiliFavoriteFolder[]> {
  const userMid = mid || await getCurrentMid(options.force)
  if (!userMid) return []
  const cache = readBiliFavoriteCache()
  const key = folderCacheKey(userMid)
  const cached = cache.folders?.[key]
  if (!options.force && cached && isFresh(cached.ts)) return cached.items

  const { getFavoriteFolders } = await import('@/services/bilibiliApi')
  const data = await getFavoriteFolders(userMid)
  const items = (data.list || []).map((folder) => ({
    id: folder.id,
    title: folder.title || '未命名收藏夹',
    mediaCount: folder.media_count || 0,
    coverUrl: normalizeBiliImageUrl(folder.cover || '') || getCachedBiliFavoriteFolderCover(folder.id),
    description: folder.intro || '',
    updatedAt: folder.mtime,
  }))
  cache.folders = { ...(cache.folders || {}), [key]: { ts: Date.now(), items } }
  writeBiliFavoriteCache(cache)
  return items
}

export async function getBiliFavoriteFolderTracks(
  mediaId: number,
  page = 1,
  pageSize = 40,
  options: { force?: boolean } = {},
): Promise<BiliFavoriteFolderPage> {
  const cache = readBiliFavoriteCache()
  const key = trackCacheKey(mediaId, page, pageSize)
  const cached = cache.tracks?.[key]
  if (!options.force && cached && isFresh(cached.ts)) return cached.page

  const { getFavoriteFolderMedias } = await import('@/services/bilibiliApi')
  const data = await getFavoriteFolderMedias(mediaId, page, pageSize)
  const medias = data.medias || []
  const tracks = medias
    .filter((media) => Boolean(media.bvid || media.bv_id))
    .map((media): Track => {
      const bvid = media.bvid || media.bv_id || ''
      return {
        id: `bili-fav-${mediaId}-${bvid || media.id}`,
        title: media.title || '未命名视频',
        artist: media.upper?.name || 'Bilibili 用户',
        coverUrl: normalizeBiliImageUrl(media.cover || ''),
        duration: media.duration || 0,
        videoUrl: `https://www.bilibili.com/video/${bvid}`,
        bvid,
        aid: media.id,
        playCount: media.cnt_info?.play || 0,
        isLiked: false,
      }
    })

  const info = data.info
    ? {
      id: data.info.id,
      title: data.info.title || '未命名收藏夹',
      mediaCount: data.info.media_count || tracks.length,
      coverUrl: normalizeBiliImageUrl(data.info.cover || ''),
      description: data.info.intro || '',
      updatedAt: data.info.mtime,
    }
    : undefined

  const fallbackCover = tracks.find((track) => track.coverUrl)?.coverUrl || ''
  const result = {
    info: info ? { ...info, coverUrl: info.coverUrl || fallbackCover } : undefined,
    tracks,
    hasMore: Boolean(data.has_more),
  }
  cache.tracks = { ...(cache.tracks || {}), [key]: { ts: Date.now(), page: result } }
  if (result.info) {
    const folderGroups = { ...(cache.folders || {}) }
    for (const [folderKey, entry] of Object.entries(folderGroups)) {
      folderGroups[folderKey] = {
        ...entry,
        items: entry.items.map((folder) => folder.id === mediaId ? { ...folder, coverUrl: folder.coverUrl || result.info?.coverUrl || '' } : folder),
      }
    }
    cache.folders = folderGroups
  }
  writeBiliFavoriteCache(cache)
  return result
}

export async function addTrackToBiliFavorite(track: Track, mediaId: number): Promise<void> {
  const { addVideoToFavoriteFolder, getVideoDetail: rendererDetail } = await import('@/services/bilibiliApi')
  let aid = Number(track.aid || 0)
  if (!aid && track.bvid) {
    const detail = await rendererDetail(track.bvid)
    aid = detail.aid || 0
  }
  if (!Number.isFinite(aid) || aid <= 0) throw new Error('这个视频缺少稿件 ID，暂时无法加入 B站收藏夹。')
  await addVideoToFavoriteFolder(aid, mediaId)

  const cache = readBiliFavoriteCache()
  const folderGroups = { ...(cache.folders || {}) }
  for (const [key, entry] of Object.entries(folderGroups)) {
    folderGroups[key] = {
      ...entry,
      ts: 0,
      items: entry.items.map((folder) => folder.id === mediaId ? { ...folder, coverUrl: folder.coverUrl || track.coverUrl } : folder),
    }
  }
  const trackGroups = Object.fromEntries(
    Object.entries(cache.tracks || {}).filter(([key]) => !key.startsWith(`${mediaId}:`)),
  )
  writeBiliFavoriteCache({ ...cache, folders: folderGroups, tracks: trackGroups })
}
