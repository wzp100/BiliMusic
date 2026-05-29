/**
 * 歌词服务（渲染层）
 *
 * 数据源：LRCLIB（开源同步歌词库，免鉴权、无污染）。取数走主进程
 * window.electronAPI.lyricsApi.search（net.fetch，无 CORS）。
 *
 * 本层职责：B站标题清洗 → 查询 → 候选排序 → LRC 解析 → 缓存 → 手动纠正。
 */

import type { Track } from '@/types'

export interface LyricLine {
  time: number // 秒；未同步歌词为 -1
  text: string
}

export interface LyricResult {
  lines: LyricLine[]
  synced: boolean
  instrumental: boolean
  trackName: string
  artistName: string
  lrclibId: number
}

interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

// ===== 桥接（主进程 LRCLIB 代理）=====

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.lyricsApi : undefined
}

async function lrclibSearch(query: { q?: string; trackName?: string; artistName?: string }): Promise<LrclibRecord[]> {
  const api = bridge()
  if (!api) return []
  try {
    return await api.search(query)
  } catch {
    return []
  }
}

// ===== B站标题清洗 / 查询候选构造 =====

// 括号内若含这些噪声词则整段移除；否则保留内部文字（避免误删括号里的歌手/歌名）
const NOISE = /(official|lyrics?|audio|video|m\/?v|hd|4k|8k|live|cover|remix|remaster|reimagined|suno|feat\.?|ft\.?|prod\.?|demo|hi-?res|歌词|动态歌词|高音质|无损|纯享|完整版|官方|现场|翻唱|翻自|改编|原唱|伴奏|钢琴版|弹唱|直播|街唱|试听|修复|重制|超清|字幕|珍藏|节目|片段|福音|男声|女声|原调|弱混|教学|讲解)/i

// 独立中文噪声词（裸词，长词在前以便先匹配）
const CJK_NOISE = /(官方版|官方MV|官方音频|官方|现场版|现场|完整版|纯享版|纯享|高音质|无损音质|无损|动态歌词|歌词版|超清|修复版|高清修复|重制版|中日字幕|双语字幕|字幕|试听|伴奏|钢琴版|翻唱|翻自|改编|原唱|纯音乐|黑人福音版|福音版|黑人福音|直播弹唱|弹唱|街唱|男声|女声|原调|弱混|珍藏|教学|讲解|课程)/g
// 独立英文噪声词（用词界，避免误伤真实单词）
const LATIN_NOISE = /\b(official|lyrics?|audio|video|m\/?v|mv|hd|4k|8k|live|remix|remaster(?:ed)?|reimagined|suno|hi-?res)\b/gi
// 分隔符（含连字符/破折号/竖线/冒号/逗号等）归一为空格 —— 漏掉连字符会让“歌名-歌手”整体变成一个 token 致 0 命中
const SEP = /[-–—_|/\\·•～~「」『』"'`*:：，,]/g
// emoji 与方向符号
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu

// 清洗单个片段：去话题/emoji/标点/分隔符/噪声词
function cleanSeg(raw: string): string {
  if (!raw) return ''
  let s = raw.normalize('NFKC')
  s = s.replace(/#[^\s#]+/g, ' ')
  s = s.replace(EMOJI, ' ')
  s = s.replace(/[!！?？.。]+/g, ' ')
  s = s.replace(SEP, ' ')
  s = s.replace(CJK_NOISE, ' ')
  s = s.replace(LATIN_NOISE, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

// 整标题清洗（保留《》内文字、去噪声括号），用于相似度比较与首个查询候选
export function cleanTitle(raw: string): string {
  if (!raw) return ''
  let s = raw.normalize('NFKC')
  s = s.replace(/[《<]([^》>]+)[》>]/g, ' $1 ') // 《歌名》保留内部
  s = s.replace(/[【[(（]([^】\])）]*)[】\])）]/g, (_m, inner: string) => (NOISE.test(inner) ? ' ' : ` ${inner} `))
  return cleanSeg(s) || raw.trim().slice(0, 40)
}

// 构造查询候选（优先级：《》歌名 → 整标题 → 各分段）。
// LRCLIB 的 q 近似 AND：标题里多一个垃圾词就 0 命中，故需分段降级——
// 垃圾段（如“黑人福音版”）单独查询返回 0 无害，歌名段会命中。
function queryCandidates(raw: string): string[] {
  const cands: string[] = []
  const push = (x: string) => {
    const v = cleanSeg(x)
    if (v.length >= 2 && !cands.includes(v)) cands.push(v)
  }
  const s = raw.normalize('NFKC')
  // 1. 《》内容（最干净的歌名）
  for (const m of s.match(/[《<]([^》>]+)[》>]/g) || []) push(m.replace(/[《<》>]/g, ''))
  // 2. 整标题清洗
  push(cleanTitle(raw))
  // 3. 按括号与分隔符切分主体，每个 chunk 作为降级候选（如“原唱：李荣浩”里的“李荣浩”）
  const parts = s.replace(/[《<》>]/g, ' ').split(/[【】[\]()（）]|[-–—_|/\\·•～~「」『』"'`*:：，,]/)
  for (const seg of parts) push(seg)
  return cands.slice(0, 6)
}

// ===== LRC 解析 =====

const TIME_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const rawLine of lrc.split('\n')) {
    TIME_TAG.lastIndex = 0
    const times: number[] = []
    let m: RegExpExecArray | null
    while ((m = TIME_TAG.exec(rawLine)) !== null) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0
      times.push(min * 60 + sec + frac)
    }
    if (!times.length) continue // 元数据行（[ti:][ar:]）等无时间戳 → 跳过
    const text = rawLine.replace(TIME_TAG, '').trim()
    if (!text) continue // 空行（间奏）跳过
    for (const t of times) out.push({ time: t, text })
  }
  return out.sort((a, b) => a.time - b.time)
}

function plainToLines(plain: string): LyricLine[] {
  return plain
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ time: -1, text }))
}

// ===== 相似度（字符 bigram Dice 系数）=====

function norm(s: string): string {
  return (s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  if (s.length === 1) { set.add(s); return set }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

function dice(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85
  const ba = bigrams(na)
  const bb = bigrams(nb)
  let inter = 0
  for (const g of ba) if (bb.has(g)) inter++
  return (2 * inter) / (ba.size + bb.size)
}

// ===== 候选排序 =====

function normIncludes(haystack: string, needle: string): boolean {
  const h = norm(haystack)
  const n = norm(needle)
  return n.length >= 2 && h.includes(n)
}

// 关键：B站 track.artist 是 UP主、几乎不等于真歌手；真歌手通常写在标题里。
// 故以“候选的歌手/歌名是否出现在原标题中”为主信号，时长仅作微调。
function scoreRecord(r: LrclibRecord, ctx: { rawTitle: string; title: string; duration: number }): number {
  if (r.instrumental) return -1000
  let score = r.syncedLyrics ? 1000 : r.plainLyrics ? 200 : -1000
  score += normIncludes(ctx.rawTitle, r.artistName) ? 250 : 0 // 歌手出现在标题 → 强信号
  score += normIncludes(ctx.rawTitle, r.trackName) ? 200 : dice(r.trackName, ctx.title) * 110 // 歌名覆盖
  if (ctx.duration > 0 && r.duration > 0) {
    score -= Math.min(Math.abs(r.duration - ctx.duration), 45) * 1.2 // 翻唱/现场时长差异大，仅微调
  }
  return score
}

function recordToResult(r: LrclibRecord): LyricResult {
  let lines: LyricLine[] = []
  let synced = false
  if (r.syncedLyrics) {
    lines = parseLrc(r.syncedLyrics)
    synced = lines.length > 0
  }
  if (!lines.length && r.plainLyrics) {
    lines = plainToLines(r.plainLyrics)
    synced = false
  }
  return {
    lines,
    synced,
    instrumental: r.instrumental,
    trackName: r.trackName,
    artistName: r.artistName,
    lrclibId: r.id,
  }
}

// ===== 缓存（localStorage）=====

const CACHE_KEY = 'bilimusic_lyrics_v1'
const MISS_TTL = 24 * 60 * 60 * 1000 // 未命中缓存 1 天后可重试

type CacheEntry =
  | { status: 'ok'; result: LyricResult }
  | { status: 'miss'; ts: number }

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeCache(map: Record<string, CacheEntry>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    /* 配额满等情况忽略 */
  }
}

function cacheOk(trackId: string, result: LyricResult): void {
  const map = readCache()
  map[trackId] = { status: 'ok', result }
  writeCache(map)
}

function cacheMiss(trackId: string): void {
  const map = readCache()
  map[trackId] = { status: 'miss', ts: Date.now() }
  writeCache(map)
}

export function clearLyricCache(trackId: string): void {
  const map = readCache()
  delete map[trackId]
  writeCache(map)
}

// ===== 对外编排 =====

/** 取某曲歌词：命中缓存直接返回；否则清洗标题→搜索→排序→解析→缓存 */
export async function getLyricForTrack(track: Track): Promise<LyricResult | null> {
  const entry = readCache()[track.id]
  if (entry?.status === 'ok') return entry.result
  if (entry?.status === 'miss' && Date.now() - entry.ts < MISS_TTL) return null

  const candidates = queryCandidates(track.title)
  if (!candidates.length) { cacheMiss(track.id); return null }

  // 分段降级检索：取首个非空候选池（最干净的候选通常即命中）。
  // 干净标题 → 首候选 1 次命中；含垃圾词标题 → 垃圾候选返回 0，自动退到歌名段。
  let pool: LrclibRecord[] = []
  for (const q of candidates) {
    pool = await lrclibSearch({ q })
    if (pool.length) break
  }
  if (!pool.length) { cacheMiss(track.id); return null }

  const ctx = { rawTitle: track.title, title: cleanTitle(track.title), duration: track.duration || 0 }
  const best = pool
    .map((r) => ({ r, s: scoreRecord(r, ctx) }))
    .sort((a, b) => b.s - a.s)[0]

  if (!best || best.s <= -900) { cacheMiss(track.id); return null }

  const result = recordToResult(best.r)
  if (!result.lines.length && !result.instrumental) { cacheMiss(track.id); return null }

  cacheOk(track.id, result)
  return result
}

/** 手动搜索候选（供歌词页"重新匹配"用） */
export async function searchLyricCandidates(query: string): Promise<LrclibRecord[]> {
  const q = query.trim()
  if (!q) return []
  return lrclibSearch({ q })
}

/** 手动选定某候选 → 落缓存并返回结果 */
export function chooseLyricCandidate(trackId: string, record: LrclibRecord): LyricResult {
  const result = recordToResult(record)
  cacheOk(trackId, result)
  return result
}

export type { LrclibRecord }
