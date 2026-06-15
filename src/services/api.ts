/**
 * biliMusic API 适配层
 *
 * Electron 环境：通过 IPC 调用主进程 API（绕过 CORS）
 * 浏览器环境：通过 renderer 端 bilibiliApi.ts 直接调用（需要 B 站 Cookie）
 */

import type { TrackSource } from '@/services/bilibiliApi'
import type { Track } from '@/types'

function isElectron(): boolean {
  return !!window.electronAPI?.biliApi
}

// 在 Electron 环境下直接用浏览器 fetch（CORS 已被主进程绕过）
// 相比 IPC net.fetch，浏览器 fetch 自带完整请求头/Cookie，不会被 B站反爬拦截
async function electronFetch<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL('https://api.bilibili.com' + path)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  }
  const resp = await fetch(url.toString(), {
    credentials: 'include',
    headers: { Referer: 'https://www.bilibili.com' },
  })
  const data = await resp.json()
  if (data.code !== 0) {
    throw { code: data.code, message: data.message, path }
  }
  return data.data as T
}

// ===== 搜索 =====

export interface SearchItem {
  bvid: string
  aid: number
  title: string
  author: string
  play: number
  duration: string
  pic: string
}

function normalizePic(pic: string): string {
  if (!pic) return ''
  const normalized = pic.startsWith('https://')
    ? pic
    : pic.startsWith('http://')
      ? pic.replace('http://', 'https://')
      : pic.startsWith('//')
        ? `https:${pic}`
        : `https:${pic}`
  if (
    typeof window !== 'undefined'
    && !window.electronAPI?.biliApi
    && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && /https:\/\/i\d+\.hdslb\.com\//.test(normalized)
  ) {
    return `${window.location.origin}/bili-image/${normalized.replace(/^https?:\/\//, 'https:/')}`
  }
  return normalized
}

export async function searchVideo(keyword: string, page = 1, pageSize = 20): Promise<{ items: SearchItem[]; totalPages: number; totalResults: number }> {
  const mapItem = (item: any): SearchItem => ({
    bvid: item.bvid,
    aid: item.aid,
    title: item.title?.replace(/<[^>]+>/g, ''),
    author: item.author,
    play: item.play,
    duration: item.duration,
    pic: normalizePic(item.pic),
  })

  // 统一走渲染进程浏览器 fetch：主进程 net.fetch 会被 B站反爬拦截（-352）
  const { searchVideo: rendererSearch } = await import('@/services/bilibiliApi')
  const data = await rendererSearch(keyword, page, pageSize)
  const totalResults = data.numResults || 0
  return {
    items: data.result?.map(mapItem) || [],
    totalPages: data.numPages || Math.ceil(totalResults / pageSize),
    totalResults,
  }
}

// ===== 视频详情 =====

export interface VideoInfo {
  bvid: string
  aid: number
  title: string
  desc: string
  pic: string
  ownerName: string
  ownerMid: number
  duration: number
  cid: number
  stat: {
    view: number
    like: number
    favorite: number
  }
}

export async function getVideoDetail(bvid: string): Promise<VideoInfo> {
  // 统一走渲染进程浏览器 fetch：主进程 net.fetch 会被 B站反爬拦截（-352）
  const { getVideoDetail: rendererDetail } = await import('@/services/bilibiliApi')
  const data = await rendererDetail(bvid)
  return {
    bvid: data.bvid,
    aid: data.aid,
    title: data.title,
    desc: data.desc?.substring(0, 100),
    pic: data.pic,
    ownerName: data.owner?.name,
    ownerMid: data.owner?.mid,
    duration: data.duration,
    cid: data.cid,
    stat: {
      view: data.stat?.view,
      like: data.stat?.like,
      favorite: data.stat?.favorite,
    },
  }
}

// ===== 评论 =====

export interface VideoComment {
  id: number
  author: string
  avatar: string
  message: string
  like: number
  replyCount: number
  createdAt: number
}

export async function getVideoComments(
  target: { bvid?: string; aid?: string | number },
  page = 1,
  pageSize = 20,
): Promise<{ items: VideoComment[]; total: number }> {
  const { getVideoDetail: rendererDetail, getVideoComments: rendererComments } = await import('@/services/bilibiliApi')
  let oid = 0

  if (target.bvid) {
    try {
      const detail = await rendererDetail(target.bvid)
      oid = Number(detail.aid) || 0
    } catch {
      oid = 0
    }
  }

  if (!oid) {
    oid = Number(target.aid) || 0
  }

  if (!oid) {
    throw new Error('无法获取当前视频的评论区 ID')
  }

  const data = await rendererComments(oid, page, pageSize)
  const replies = data.replies || []
  return {
    items: replies.map((reply) => ({
      id: reply.rpid,
      author: reply.member?.uname || 'Bilibili 用户',
      avatar: normalizePic(reply.member?.avatar || ''),
      message: reply.content?.message || '',
      like: reply.like || 0,
      replyCount: reply.rcount || 0,
      createdAt: reply.ctime || 0,
    })),
    total: data.page?.count || replies.length,
  }
}

// ===== 提取音频 =====

export async function extractAudio(
  bvid: string,
  fallback?: { aid?: string | number; cid?: string | number },
): Promise<TrackSource> {
  // 统一走渲染进程浏览器 fetch：主进程 net.fetch 会被 B站反爬拦截（-352）
  const { extractAudioFromVideo } = await import('@/services/bilibiliApi')
  return extractAudioFromVideo(bvid, fallback)
}

// ===== 下载音频 =====

export async function downloadAudio(audioUrl: string, filename: string): Promise<{ filePath: string; size: number }> {
  if (isElectron()) {
    return window.electronAPI.biliApi.downloadAudio(audioUrl, filename)
  }

  throw new Error('Audio download requires Electron environment')
}

// ===== 用户信息 =====

export async function getUserInfo(): Promise<{ isLogin: boolean; mid: number; uname: string; face: string }> {
  // 统一走渲染进程浏览器 fetch：主进程 net.fetch 会被 B站反爬拦截（-352）
  const { getNavInfo } = await import('@/services/bilibiliApi')
  const data = await getNavInfo()
  return {
    isLogin: data.isLogin,
    mid: data.mid,
    uname: data.uname,
    face: data.face || '',
  }
}

// ===== 音乐排行榜 =====

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

  // 统一走渲染进程浏览器 fetch：主进程 net.fetch 会被 B站反爬拦截（-352）
  const { getMusicRanking: rendererRanking } = await import('@/services/bilibiliApi')
  const data = await rendererRanking()
  return (Array.isArray(data) ? data : (data as any).list || (data as any).data || []).map(parseItem)
}

// ===== 音乐中心（music.bilibili.com/pc/music-center 同源数据） =====

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

// 综合榜顶层 bvid 是 music-metadata 伪 id（/x/web-interface/view 返回 -404），
// 实际可播放稿件在 related_archive.bvid；新歌无 related_archive，用顶层 bvid。
function playableBvid(x: import('@/services/bilibiliApi').MusicCenterItem): string {
  return x.related_archive?.bvid || x.bvid
}

function mapMusicSong(x: import('@/services/bilibiliApi').MusicCenterItem): MusicSong {
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

// 综合热歌榜
export async function getMusicCenterRank(ps = 30): Promise<MusicSong[]> {
  const { getMusicComprehensiveRank } = await import('@/services/bilibiliApi')
  const list = await getMusicComprehensiveRank(ps)
  return list.filter((x) => playableBvid(x)).map(mapMusicSong)
}

// 新歌速递
export async function getNewSongs(): Promise<MusicSong[]> {
  const { getNewMusic } = await import('@/services/bilibiliApi')
  const list = await getNewMusic()
  return list.filter((x) => x.bvid).map(mapMusicSong)
}

// ===== B站收藏夹 =====

export interface BiliFavoriteFolder {
  id: number
  title: string
  mediaCount: number
  coverUrl: string
  description: string
  updatedAt?: number
}

export async function getBiliFavoriteFolders(
  mid?: number,
): Promise<BiliFavoriteFolder[]> {
  const userMid = mid || (await getUserInfo()).mid
  if (!userMid) return []
  const { getFavoriteFolders } = await import('@/services/bilibiliApi')
  const data = await getFavoriteFolders(userMid)
  return (data.list || []).map((folder) => ({
    id: folder.id,
    title: folder.title || '未命名收藏夹',
    mediaCount: folder.media_count || 0,
    coverUrl: normalizePic(folder.cover || ''),
    description: folder.intro || '',
    updatedAt: folder.mtime,
  }))
}

export async function getBiliFavoriteFolderCover(mediaId: number): Promise<string> {
  const { getFavoriteFolderMedias } = await import('@/services/bilibiliApi')
  const detail = await getFavoriteFolderMedias(mediaId, 1, 40)
  const firstCover = detail.medias?.find((media) => media.cover)?.cover || ''
  return normalizePic(firstCover)
}

export async function getBiliFavoriteFolderTracks(
  mediaId: number,
  page = 1,
  pageSize = 40,
): Promise<{ info?: BiliFavoriteFolder; tracks: Track[]; hasMore: boolean }> {
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
        coverUrl: normalizePic(media.cover || ''),
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
      coverUrl: normalizePic(data.info.cover || ''),
      description: data.info.intro || '',
      updatedAt: data.info.mtime,
    }
    : undefined

  return { info, tracks, hasMore: Boolean(data.has_more) }
}

// ===== 搜索 UP主 =====

export interface UserResult {
  mid: number
  name: string
  avatar: string
  sign: string
  fans: number
  videoCount: number
  level: number
}

export async function searchUsers(keyword: string, page = 1, pageSize = 20): Promise<{ items: UserResult[]; totalPages: number; totalResults: number }> {
  const { searchUser } = await import('@/services/bilibiliApi')
  const data = await searchUser(keyword, page, pageSize)
  const items = (data.result || []).map((u) => ({
    mid: u.mid,
    name: u.uname?.replace(/<[^>]+>/g, '') || '',
    avatar: normalizePic(u.upic),
    sign: u.usign || '',
    fans: u.fans || 0,
    videoCount: u.videos || 0,
    level: u.level || 0,
  }))
  const totalResults = data.numResults || 0
  return { items, totalPages: data.numPages || Math.ceil(totalResults / pageSize), totalResults }
}

// ===== UP主 投稿视频 =====

export interface UpVideo {
  bvid: string
  title: string
  coverUrl: string
  duration: number
  play: number
  created: number
}

// "mm:ss" / "hh:mm:ss" → 秒
function parseLength(len: string): number {
  if (!len) return 0
  const parts = len.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

export async function getUserVideos(mid: number, page = 1, pageSize = 30): Promise<{ items: UpVideo[]; total: number }> {
  const { getUserVideos: rendererUserVideos } = await import('@/services/bilibiliApi')
  const data = await rendererUserVideos(mid, page, pageSize)
  const items = (data.list?.vlist || []).map((v) => ({
    bvid: v.bvid,
    title: v.title?.replace(/<[^>]+>/g, '') || '',
    coverUrl: normalizePic(v.pic),
    duration: parseLength(v.length),
    play: v.play || 0,
    created: v.created || 0,
  }))
  return { items, total: data.page?.count || 0 }
}

// ===== 个性化推荐 =====

export async function getRecommendVideos(ps = 20): Promise<VideoInfo[]> {
  const parseItem = (v: any): VideoInfo => ({
    bvid: v.bvid,
    aid: v.id || v.aid,
    title: v.title,
    desc: v.desc || '',
    pic: normalizePic(v.pic),
    ownerName: v.owner?.name || v.author || '',
    ownerMid: v.owner?.mid || v.mid || 0,
    duration: v.duration || 0,
    cid: v.cid || 0,
    stat: {
      view: v.stat?.view || v.play || 0,
      like: v.stat?.like || 0,
      favorite: v.stat?.favorite || v.favorites || 0,
    },
  })

  if (isElectron()) {
    const data = await electronFetch<{ item: any[] }>('/x/web-interface/index/top/rcmd', { ps })
    return (data.item || []).map(parseItem)
  }

  const { getRecommendedVideos: rendererRec } = await import('@/services/bilibiliApi')
  const data = await rendererRec(ps)
  return (data.item || []).map(parseItem)
}

// ===== 关注动态视频 =====

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

export async function getFollowingDynamicVideos(
  pageSize = 20,
  offset = '',
  options: { preloadAudio?: boolean } = {},
): Promise<DynamicVideoPage> {
  let user: { isLogin: boolean; mid: number; uname: string; face: string }
  try {
    user = await getUserInfo()
  } catch {
    return { videos: [], hasMore: false, offset: '' }
  }
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
        coverUrl: normalizePic(archive.cover || ''),
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

// ===== B站官方字幕 =====

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

function preferSubtitle(
  subtitles: import('@/services/bilibiliApi').PlayerSubtitleItem[],
): import('@/services/bilibiliApi').PlayerSubtitleItem | undefined {
  return subtitles.find((item) => {
    const lan = `${item.lan} ${item.lan_doc}`.toLowerCase()
    return lan.includes('zh') || lan.includes('中文') || lan.includes('chinese')
  }) || subtitles[0]
}

export async function getBiliOfficialSubtitle(track: Track): Promise<OfficialSubtitleResult | null> {
  const bvid = track.bvid || track.id
  if (!bvid) return null
  const {
    getVideoDetail: rendererDetail,
    getVideoSubtitleList,
    getSubtitleFile,
  } = await import('@/services/bilibiliApi')

  try {
    const cid = track.cid || (await rendererDetail(bvid)).cid
    if (!cid) return null
    const subtitles = await getVideoSubtitleList(bvid, cid)
    const selected = preferSubtitle(subtitles)
    if (!selected?.subtitle_url) return null
    const file = await getSubtitleFile(selected.subtitle_url)
    const lines = (file.body || [])
      .filter((line) => line.content && Number.isFinite(line.from))
      .map((line) => ({
        from: Number(line.from),
        to: Number(line.to || line.from),
        content: line.content.trim(),
      }))
    if (!lines.length) return null
    return {
      lines,
      lan: selected.lan || '',
      lanDoc: selected.lan_doc || '',
      sourceId: `bili-subtitle:${bvid}:${cid}`,
    }
  } catch {
    return null
  }
}

// ===== 热门/推荐 =====

export async function getPopularVideos(ps = 10, pn = 1): Promise<VideoInfo[]> {
  // 统一走渲染进程浏览器 fetch：主进程 net.fetch 会被 B站反爬拦截（-352）
  const { getPopularVideos: rendererPopular } = await import('@/services/bilibiliApi')
  const data = await rendererPopular(ps, pn)
  return data.list?.map((v) => ({
    bvid: v.bvid,
    aid: v.aid,
    title: v.title,
    desc: '',
    pic: normalizePic(v.pic),
    ownerName: v.owner?.name,
    ownerMid: v.owner?.mid,
    duration: v.duration,
    cid: v.cid,
    stat: {
      view: v.stat?.view,
      like: v.stat?.like,
      favorite: v.stat?.favorite,
    },
  })) || []
}

// ===== 扫码登录 =====

export interface QrCodeData {
  url: string
  qrcodeKey: string
}

export interface QrPollResult {
  code: number
  status: number
  message: string
  url: string
}

export async function generateQrCode(): Promise<QrCodeData> {
  if (isElectron()) {
    const data = await window.electronAPI.biliApi.qrGenerate()
    return { url: data.url, qrcodeKey: data.qrcodeKey }
  }

  const { generateQrCode: rendererGen } = await import('@/services/bilibiliApi')
  return rendererGen()
}

export async function pollQrCode(qrcodeKey: string): Promise<QrPollResult> {
  if (isElectron()) {
    return window.electronAPI.biliApi.qrPoll(qrcodeKey)
  }

  const { pollQrCode: rendererPoll } = await import('@/services/bilibiliApi')
  return rendererPoll(qrcodeKey)
}

export async function getLoginStatus(): Promise<{ isLoggedIn: boolean; sessdata?: string }> {
  if (isElectron()) {
    const cookies = await window.electronAPI.biliApi.getCookies()
    return { isLoggedIn: cookies.isLoggedIn, sessdata: cookies.sessdata }
  }

  // 浏览器环境：通过 nav API 检测
  const info = await getUserInfo()
  return { isLoggedIn: info.isLogin }
}

export async function logout(): Promise<void> {
  if (isElectron()) {
    await window.electronAPI.biliApi.logout()
    return
  }

  // 浏览器环境无法清除 bilibili.com 的 Cookie（跨域）
  throw new Error('Logout requires Electron environment')
}
