import type { MusicCenterItem } from '@/services/bilibiliApi'
import type { VideoInfo } from '@/services/biliTypes'
import { normalizeBiliImageUrl } from '@/services/media'
import type { Track } from '@/types'

const normalizePic = normalizeBiliImageUrl

export type { VideoInfo } from '@/services/biliTypes'

export interface MusicSong {
  bvid: string
  aid: string
  cid: string
  title: string
  artist: string
  coverUrl: string
  album: string
  publishTime?: string
}

interface MusicMetadataCache {
  ts: number
  items: MusicSong[]
}

interface VideoPageMusicCacheEntry {
  ts: number
  metadata: BiliMusicPageMetadata | null
}

interface BiliMusicPageMetadata {
  musicId?: string
  title?: string
  artist?: string
  albumTitle?: string
  coverUrl?: string
}

const MUSIC_METADATA_CACHE_TTL_MS = 5 * 60 * 1000
const VIDEO_PAGE_MUSIC_CACHE_TTL_MS = 10 * 60 * 1000
let musicMetadataCache: MusicMetadataCache | null = null
let musicMetadataReady: Promise<MusicSong[]> | null = null
const videoPageMusicCache = new Map<string, VideoPageMusicCacheEntry>()

export async function getMusicRanking(): Promise<VideoInfo[]> {
  const parseItem = (v: any): VideoInfo => {
    const dur = typeof v.duration === 'string'
      ? v.duration.split(':').reduce((acc: number, t: string) => acc * 60 + parseInt(t), 0)
      : (v.duration || 0)
    return {
      bvid: v.bvid,
      aid: v.aid,
      title: v.title,
      desc: v.description || v.desc || '',
      pic: normalizePic(v.pic),
      ownerName: v.author || v.owner?.name || '',
      ownerMid: v.mid || v.owner?.mid || 0,
      duration: dur,
      cid: v.cid || 0,
      stat: {
        view: v.play || v.stat?.view || 0,
        like: v.stat?.like || 0,
        favorite: v.favorites || v.stat?.favorite || 0,
      },
    }
  }

  // 来源：https://www.bilibili.com/v/popular/rank/music
  // 该页面当前由 /x/web-interface/ranking/v2?rid=1003&type=all 注水。
  const { getMusicPopularRank } = await import('@/services/bilibiliApi')
  const data = await getMusicPopularRank()
  return (data.list || []).map(parseItem)
}

export async function getMusicChannelRecommendations(page = 1, pageSize = 20): Promise<VideoInfo[]> {
  const parseItem = (v: any): VideoInfo => ({
    bvid: v.bvid,
    aid: v.aid,
    title: v.title,
    desc: v.description || v.desc || '',
    pic: normalizePic(v.pic || v.cover || ''),
    ownerName: v.author || v.owner?.name || '',
    ownerMid: v.mid || v.owner?.mid || 0,
    duration: typeof v.duration === 'string' ? parseLength(v.duration) : (v.duration || 0),
    cid: v.cid || 0,
    stat: {
      view: v.play || v.stat?.view || 0,
      like: v.stat?.like || 0,
      favorite: v.favorites || v.stat?.favorite || 0,
    },
  })

  const { getMusicChannelDynamic, getRecommendedVideos: rendererRec } = await import('@/services/bilibiliApi')
  try {
    const data = await getMusicChannelDynamic(page, pageSize)
    const list = data.archives || []
    if (list.length) return list.map(parseItem)
  } catch {
    // 音乐频道抓取失败时保留原推荐接口兜底。
  }

  const fallback = await rendererRec(pageSize)
  return (fallback.item || []).map(parseItem)
}

export async function getMusicCenterRank(ps = 30): Promise<MusicSong[]> {
  const { getMusicComprehensiveRank } = await import('@/services/bilibiliApi')
  const list = await getMusicComprehensiveRank(ps)
  return list.filter((x) => playableBvid(x)).map(mapMusicSong)
}

export async function getNewSongs(): Promise<MusicSong[]> {
  const { getNewMusic } = await import('@/services/bilibiliApi')
  const list = await getNewMusic()
  return list.filter((x) => x.bvid).map(mapMusicSong)
}

export async function getBiliMusicMetadataForTrack(track: Track): Promise<Partial<Track> | null> {
  const pageMetadata = await getVideoPageMusicMetadata(track)
  if (pageMetadata) {
    return {
      title: pageMetadata.title || track.title,
      artist: pageMetadata.artist || track.artist,
      albumTitle: pageMetadata.albumTitle || track.albumTitle,
      coverUrl: pageMetadata.coverUrl || track.coverUrl,
    }
  }

  const items = await getCachedMusicMetadata()
  const matched = findMusicTrack(items, track)
  if (matched) {
    return {
      title: matched.title || track.title,
      artist: matched.artist || track.artist,
      albumTitle: matched.album || track.albumTitle,
      coverUrl: matched.coverUrl || track.coverUrl,
      aid: track.aid || matched.aid,
      cid: track.cid || matched.cid,
    }
  }

  return null
}

async function getCachedMusicMetadata(): Promise<MusicSong[]> {
  if (musicMetadataCache && Date.now() - musicMetadataCache.ts < MUSIC_METADATA_CACHE_TTL_MS) {
    return musicMetadataCache.items
  }
  if (musicMetadataReady) return musicMetadataReady
  musicMetadataReady = (async () => {
    const settled = await Promise.allSettled([
      getMusicCenterRank(60),
      getNewSongs(),
    ])
    const items = settled.flatMap((entry) => entry.status === 'fulfilled' ? entry.value : [])
    const unique = dedupeMusicSongs(items)
    musicMetadataCache = { ts: Date.now(), items: unique }
    musicMetadataReady = null
    return unique
  })()
  return musicMetadataReady
}

function dedupeMusicSongs(items: MusicSong[]): MusicSong[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.bvid}:${item.aid}:${item.cid}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findMusicTrack(items: MusicSong[], track: Track): MusicSong | undefined {
  if (track.cid) {
    return items.find((item) => item.cid && String(item.cid) === String(track.cid))
  }

  if (track.bvid) {
    const bvidMatches = items.filter((item) => item.bvid === track.bvid)
    if (bvidMatches.length === 1) return bvidMatches[0]
  }

  if (track.aid) {
    const aidMatches = items.filter((item) => item.aid && String(item.aid) === String(track.aid))
    if (aidMatches.length === 1) return aidMatches[0]
  }

  return undefined
}

async function getVideoPageMusicMetadata(track: Track): Promise<BiliMusicPageMetadata | null> {
  if (!track.bvid) return null
  const pageUrl = buildVideoPageUrl(track)
  const cached = videoPageMusicCache.get(pageUrl)
  if (cached && Date.now() - cached.ts < VIDEO_PAGE_MUSIC_CACHE_TTL_MS) return cached.metadata

  try {
    const resp = await fetch(videoPageProxyUrl(pageUrl), {
      credentials: 'include',
      headers: {
        Referer: 'https://www.bilibili.com',
        ...(isBrowserDevProxyAvailable() ? { 'X-Bili-Referer': 'https://www.bilibili.com' } : {}),
      },
    })
    const html = await resp.text()
    const pageMetadata = parseVideoPageMusicMetadata(html)
    const detailMetadata = pageMetadata.musicId ? await getBgmDetailMetadata(pageMetadata.musicId) : null
    const metadata = mergeMusicMetadata(pageMetadata, detailMetadata)
    videoPageMusicCache.set(pageUrl, { ts: Date.now(), metadata })
    return metadata
  } catch {
    videoPageMusicCache.set(pageUrl, { ts: Date.now(), metadata: null })
    return null
  }
}

function buildVideoPageUrl(track: Track): string {
  if (track.videoUrl) {
    try {
      const source = new URL(track.videoUrl)
      if (source.searchParams.get('p')) {
        return `https://www.bilibili.com/video/${track.bvid}/?p=${source.searchParams.get('p')}`
      }
    } catch {
      // ignore malformed stored url
    }
  }
  return `https://www.bilibili.com/video/${track.bvid}/`
}

function parseVideoPageMusicMetadata(html: string): BiliMusicPageMetadata | null {
  const tagMetadata = parseBgmTagMetadata(html)
  if (tagMetadata?.musicId) return tagMetadata

  const musicNode = html.match(/<div[^>]*class=["'][^"']*\bbpx-player-music\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  const fromNode = musicNode ? extractDiscoverMusicTitle(decodeHtml(stripHtml(musicNode[1]))) : ''
  if (fromNode) return { title: fromNode }

  const keywords = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']keywords["'][^>]*>/i)
  const fromKeywords = keywords ? extractDiscoverMusicTitle(decodeHtml(keywords[1])) : ''
  return fromKeywords ? { title: fromKeywords } : null
}

function parseBgmTagMetadata(html: string): BiliMusicPageMetadata | null {
  const tagMatches = html.matchAll(/\{[^{}]*"tag_type":"bgm"[^{}]*}/g)
  for (const match of tagMatches) {
    try {
      const tag = JSON.parse(match[0])
      const title = extractDiscoverMusicTitle(String(tag.tag_name || ''))
      const musicId = String(tag.music_id || '')
      if (title || musicId) return { title, musicId }
    } catch {
      // keep scanning other tag objects
    }
  }
  const fallback = html.match(/"tag_name":"发现《([^》]+)》"[^{}]*"music_id":"([^"]+)"/)
  if (!fallback) return null
  return { title: fallback[1]?.trim(), musicId: fallback[2]?.trim() }
}

async function getBgmDetailMetadata(musicId: string): Promise<BiliMusicPageMetadata | null> {
  if (!musicId) return null
  const url = new URL('https://api.bilibili.com/x/copyright-music-publicity/bgm/detail')
  url.searchParams.set('music_id', musicId)
  url.searchParams.set('relation_from', 'bgm_page')
  const resp = await fetch(biliApiProxyUrl(url), {
    credentials: 'include',
    headers: {
      Referer: 'https://www.bilibili.com',
      ...(isBrowserDevProxyAvailable() ? { 'X-Bili-Referer': 'https://www.bilibili.com' } : {}),
    },
  })
  const json = await resp.json()
  if (json?.code !== 0 || !json.data) return null
  const data = json.data
  return {
    musicId,
    title: String(data.music_title || ''),
    artist: formatMusicArtists(data),
    albumTitle: String(data.album || ''),
    coverUrl: normalizePic(data.mv_cover || ''),
  }
}

function formatMusicArtists(data: any): string {
  if (Array.isArray(data.artists_list) && data.artists_list.length) {
    const artists = data.artists_list.map((item: any) => String(item?.name || '').trim()).filter(Boolean)
    if (artists.length) return artists.join('、')
  }
  return String(data.origin_artist_list || data.origin_artist || '').trim()
}

function mergeMusicMetadata(
  base: BiliMusicPageMetadata | null,
  detail: BiliMusicPageMetadata | null,
): BiliMusicPageMetadata | null {
  if (!base && !detail) return null
  return {
    musicId: detail?.musicId || base?.musicId,
    title: detail?.title || base?.title,
    artist: detail?.artist || base?.artist,
    albumTitle: detail?.albumTitle || base?.albumTitle,
    coverUrl: detail?.coverUrl || base?.coverUrl,
  }
}

function extractDiscoverMusicTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const discovered = normalized.match(/发现\s*《([^》]{1,80})》/)
  return discovered?.[1]?.trim() || ''
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ')
}

function decodeHtml(input: string): string {
  if (!input) return ''
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = input
    return textarea.value
  }
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function isBrowserDevProxyAvailable(): boolean {
  if (typeof window === 'undefined') return false
  if (window.electronAPI?.biliApi) return false
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

function videoPageProxyUrl(url: string): string {
  if (!url || !isBrowserDevProxyAvailable()) return url
  return `${window.location.origin}/bili-page?url=${encodeURIComponent(url)}`
}

function biliApiProxyUrl(url: URL): string {
  if (!isBrowserDevProxyAvailable()) return url.toString()
  const proxy = new URL(`${window.location.origin}/bili-api${url.pathname}`)
  url.searchParams.forEach((value, key) => proxy.searchParams.set(key, value))
  return proxy.toString()
}

function playableBvid(x: MusicCenterItem): string {
  return x.related_archive?.bvid || x.bvid
}

function mapMusicSong(x: MusicCenterItem): MusicSong {
  return {
    bvid: playableBvid(x),
    // 顶层 avid+cid：bvid 稿件 -404 时的回退音源（related_archive.cid 不可靠）
    aid: String(x.aid || ''),
    cid: String(x.cid || ''),
    title: x.music_title,
    artist: x.author,
    coverUrl: normalizePic(x.cover),
    album: x.album || '',
    publishTime: x.publish_time,
  }
}

function parseLength(len: string): number {
  if (!len) return 0
  const parts = len.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}
