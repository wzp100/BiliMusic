import type { Track } from '@/types'
import type { BiliSubtitleFile, PlayerSubtitleItem, VideoDetail } from '@/services/bilibiliApi'

export interface OfficialSubtitleLine {
  from: number
  to: number
  content: string
}

export interface OfficialSubtitleResult {
  lines: OfficialSubtitleLine[]
  lan: string
  lanDoc: string
  sourceId: string
}

export interface OfficialSubtitleOption {
  id: string
  lan: string
  lanDoc: string
  subtitleUrl: string
  label: string
}

interface SubtitleContext {
  bvid: string
  cid: string | number
  subtitles: PlayerSubtitleItem[]
}

const SUBTITLE_CACHE_TTL_MS = 5 * 60 * 1000
const subtitleContextCache = new Map<string, { ts: number; ctx: SubtitleContext | null }>()
const subtitleFileCache = new Map<string, { ts: number; file: BiliSubtitleFile }>()

function isCacheFresh(ts: number): boolean {
  return Date.now() - ts < SUBTITLE_CACHE_TTL_MS
}

function subtitlePreferenceScore(item: PlayerSubtitleItem): number {
  const lan = `${item.lan} ${item.lan_doc}`.toLowerCase()
  if (lan.includes('zh-hans') || lan.includes('简体')) return 0
  if (lan.includes('zh') || lan.includes('中文') || lan.includes('chinese')) return 1
  if (lan.includes('ja') || lan.includes('jp') || lan.includes('日文') || lan.includes('日语')) return 2
  if (lan.includes('en') || lan.includes('英文') || lan.includes('english')) return 3
  return 4
}

function sortSubtitlesByPreference(
  subtitles: PlayerSubtitleItem[],
): PlayerSubtitleItem[] {
  return subtitles
    .map((item, index) => ({ item, index, score: subtitlePreferenceScore(item) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((row) => row.item)
}

async function getTrackSubtitleContext(track: Track): Promise<SubtitleContext | null> {
  const bvid = track.bvid || track.id
  if (!bvid) return null
  const pageNumber = pageNumberFromTrack(track)
  const contextKey = `${bvid}:${track.cid ? `cid:${track.cid}` : pageNumber ? `p:${pageNumber}` : ''}`
  const cached = subtitleContextCache.get(contextKey)
  if (cached && isCacheFresh(cached.ts)) return cached.ctx

  const {
    getVideoDetail: rendererDetail,
    getVideoSubtitleList,
  } = await import('@/services/bilibiliApi')

  try {
    const detail = await rendererDetail(bvid)
    const cids = collectSubtitleCandidateCids(track, detail)
    for (const cid of cids) {
      try {
        const subtitles = await getVideoSubtitleList(bvid, cid)
        if (subtitles.length) {
          const ctx = { bvid, cid, subtitles }
          subtitleContextCache.set(contextKey, { ts: Date.now(), ctx })
          return ctx
        }
      } catch {
        // 多 P 或历史曲目里 cid 可能过期，继续试下一个候选 cid。
      }
    }
    subtitleContextCache.set(contextKey, { ts: Date.now(), ctx: null })
    return null
  } catch {
    subtitleContextCache.set(contextKey, { ts: Date.now(), ctx: null })
    return null
  }
}

function collectSubtitleCandidateCids(track: Track, detail: VideoDetail): Array<string | number> {
  const cids: Array<string | number> = []
  const push = (cid?: string | number) => {
    if (!cid) return
    if (!cids.some((item) => String(item) === String(cid))) cids.push(cid)
  }
  push(track.cid)
  if (track.cid) return cids
  const pages = detail.pages || []

  if (pages.length > 1) {
    const pageNumber = pageNumberFromTrack(track)
    const matched = pageNumber
      ? pages.find((page, index) => (page.page || index + 1) === pageNumber)
      : undefined
    push(matched?.cid)
    return cids
  }

  push(detail.cid)
  for (const page of pages) push(page.cid)
  return cids
}

function pageNumberFromTrack(track: Track): number | null {
  try {
    const page = track.videoUrl
      ? Number(new URL(track.videoUrl).searchParams.get('p'))
      : 0
    if (Number.isFinite(page) && page > 0) return page
  } catch {
    // 非标准 URL 继续尝试从 id 解析。
  }

  const match = String(track.id || '').match(/-p(\d+)$/i)
  if (!match) return null
  const page = Number(match[1])
  return Number.isFinite(page) && page > 0 ? page : null
}

function subtitleOptionId(item: PlayerSubtitleItem, index: number): string {
  const basis = `${item.subtitle_url || item.lan || item.lan_doc || ''}:${item.id ?? ''}`
  let hash = 0
  for (let i = 0; i < basis.length; i += 1) {
    hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0
  }
  return `${index}:${Math.abs(hash).toString(36)}`
}

function subtitleLabel(item: PlayerSubtitleItem, index: number): string {
  return item.lan_doc || item.lan || `字幕 ${index + 1}`
}

export async function getBiliOfficialSubtitleOptions(track: Track): Promise<OfficialSubtitleOption[]> {
  const ctx = await getTrackSubtitleContext(track)
  if (!ctx) return []
  return sortSubtitlesByPreference(ctx.subtitles)
    .map((item) => {
      const sourceIndex = ctx.subtitles.indexOf(item)
      return {
        id: subtitleOptionId(item, sourceIndex),
        lan: item.lan || '',
        lanDoc: item.lan_doc || '',
        subtitleUrl: item.subtitle_url,
        label: subtitleLabel(item, sourceIndex),
      }
    })
    .filter((item) => Boolean(item.subtitleUrl))
}

export async function getBiliOfficialSubtitle(
  track: Track,
  subtitleId?: string,
): Promise<OfficialSubtitleResult | null> {
  const ctx = await getTrackSubtitleContext(track)
  if (!ctx) return null

  const selectedRows = subtitleId
    ? ctx.subtitles.filter((item, index) => subtitleOptionId(item, index) === subtitleId)
    : sortSubtitlesByPreference(ctx.subtitles)

  for (const selected of selectedRows) {
    if (!selected?.subtitle_url) continue
    try {
      const file = await getCachedSubtitleFile(selected.subtitle_url)
      const lines = (file.body || [])
        .filter((line) => line.content && Number.isFinite(line.from))
        .map((line) => ({
          from: Number(line.from),
          to: Number(line.to || line.from),
          content: line.content.trim(),
        }))
      if (!lines.length) continue
      return {
        lines,
        lan: selected.lan || '',
        lanDoc: selected.lan_doc || '',
        sourceId: `bili-subtitle-v2:${ctx.bvid}:${ctx.cid}:${subtitleOptionId(selected, ctx.subtitles.indexOf(selected))}`,
      }
    } catch {
      if (subtitleId) return null
    }
  }
  return null
}

async function getCachedSubtitleFile(subtitleUrl: string): Promise<BiliSubtitleFile> {
  const cached = subtitleFileCache.get(subtitleUrl)
  if (cached && isCacheFresh(cached.ts)) return cached.file

  const { getSubtitleFile } = await import('@/services/bilibiliApi')
  const file = await getSubtitleFile(subtitleUrl)
  subtitleFileCache.set(subtitleUrl, { ts: Date.now(), file })
  return file
}
