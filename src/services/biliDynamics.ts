import { extractAudio } from '@/services/api'
import { normalizeBiliImageUrl } from '@/services/media'

export interface DynamicVideo {
  id: string
  bvid: string
  aid: string
  cid: string
  audioUrl?: string
  title: string
  coverUrl: string
  duration: number
  playCount: number
  author: string
  authorMid: number
  publishedAt: number
}

export interface DynamicVideoPage {
  videos: DynamicVideo[]
  hasMore: boolean
  offset: string
}

function parseDurationText(text: string): number {
  if (!text) return 0
  const parts = text.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

function parseCountText(text: string | undefined): number {
  if (!text) return 0
  const normalized = text.trim()
  if (normalized.endsWith('万')) return Math.round(Number(normalized.slice(0, -1)) * 10000) || 0
  if (normalized.endsWith('亿')) return Math.round(Number(normalized.slice(0, -1)) * 100000000) || 0
  return Number(normalized) || 0
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('请求超时')), timeoutMs)
    }),
  ])
}

async function getCurrentUser(): Promise<{ isLogin: boolean; mid: number; uname: string }> {
  try {
    const { getNavInfo } = await import('@/services/bilibiliApi')
    const data = await getNavInfo()
    return {
      isLogin: Boolean(data.isLogin),
      mid: Number(data.mid || 0),
      uname: data.uname || '',
    }
  } catch {
    return { isLogin: false, mid: 0, uname: '' }
  }
}

export async function getFollowingDynamicVideos(
  pageSize = 20,
  offset = '',
  options: { preloadAudio?: boolean } = {},
): Promise<DynamicVideoPage> {
  const user = await getCurrentUser()
  if (!user.isLogin || !user.mid) return { videos: [], hasMore: false, offset: '' }

  const { getFollowingDynamicVideos: rendererDynamicVideos } = await import('@/services/bilibiliApi')
  const data = await rendererDynamicVideos(offset)
  const videos = (data.items || [])
    .map((item) => {
      const archive = item.modules?.module_dynamic?.major?.archive
      const author = item.modules?.module_author
      if (!archive?.bvid) return null
      return {
        id: item.id_str || archive.bvid,
        bvid: archive.bvid,
        aid: String(archive.aid || ''),
        cid: String(archive.cid || ''),
        title: archive.title || '未命名视频',
        coverUrl: normalizeBiliImageUrl(archive.cover || ''),
        duration: parseDurationText(archive.duration_text || ''),
        playCount: parseCountText(archive.stat?.play),
        author: author?.name || user.uname || 'Bilibili 用户',
        authorMid: author?.mid || user.mid,
        publishedAt: author?.pub_ts || 0,
      }
    })
    .filter((item): item is DynamicVideo => Boolean(item))
    .slice(0, pageSize)

  const preloadCount = options.preloadAudio === false ? 0 : Math.min(videos.length, 8)
  for (let i = 0; i < preloadCount; i += 4) {
    const batch = videos.slice(i, i + 4)
    await Promise.all(batch.map(async (video, index) => {
      try {
        const source = await withTimeout(extractAudio(video.bvid, { aid: video.aid, cid: video.cid }), 5000)
        videos[i + index] = {
          ...video,
          audioUrl: source.audioUrl,
          duration: video.duration || source.duration,
        }
      } catch {
        // 单个动态视频可能被删除、限权或无音频流，不影响其它动态展示。
      }
    }))
  }

  return {
    videos,
    hasMore: Boolean(data.has_more),
    offset: data.offset || '',
  }
}
