import { useState, useEffect, useCallback, useRef } from 'react'
import type { Track } from '@/types'
import {
  getLyricForTrack,
  searchLyricCandidates,
  chooseLyricCandidate,
  chooseOfficialSubtitle,
  clearLyricCache,
  getOfficialSubtitleCandidates,
  type LyricResult,
  type LyricCandidate,
  type OfficialSubtitleOption,
} from '@/services/lyrics'

export type LyricStatus = 'idle' | 'loading' | 'ok' | 'unsynced' | 'empty'

/**
 * 按当前曲目懒加载歌词（仅当 enabled，即歌词页打开时）。
 * 过期请求丢弃，避免快速切歌时的竞态。
 */
export function useLyrics(track: Track | null, enabled: boolean) {
  const [status, setStatus] = useState<LyricStatus>('idle')
  const [result, setResult] = useState<LyricResult | null>(null)
  const reqIdRef = useRef(0)
  const trackKey = track
    ? `${track.id}:${track.bvid || ''}:${track.cid || ''}:${track.title}`
    : ''

  const load = useCallback(async (t: Track) => {
    const reqId = ++reqIdRef.current
    setStatus('loading')
    setResult(null)
    const res = await getLyricForTrack(t)
    if (reqId !== reqIdRef.current) return // 已切歌，丢弃过期结果
    if (!res || (!res.lines.length && !res.instrumental)) {
      setStatus('empty')
      setResult(null)
      return
    }
    setResult(res)
    setStatus(res.synced ? 'ok' : 'unsynced')
  }, [])

  useEffect(() => {
    if (!enabled || !track) return
    load(track)
    // 仅在曲目或官方字幕定位信息变化时重取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, trackKey])

  const search = useCallback((q: string): Promise<LyricCandidate[]> => searchLyricCandidates(q), [])

  const choose = useCallback(async (record: LyricCandidate) => {
    if (!track) return
    setStatus('loading')
    const res = await chooseLyricCandidate(track, record)
    if (!res) {
      setStatus('empty')
      setResult(null)
      return
    }
    setResult(res)
    setStatus(res.synced ? 'ok' : 'unsynced')
  }, [track])

  const listOfficialSubtitles = useCallback((): Promise<OfficialSubtitleOption[]> => {
    if (!track) return Promise.resolve([])
    return getOfficialSubtitleCandidates(track)
  }, [track])

  const chooseSubtitle = useCallback(async (subtitleId: string) => {
    if (!track) return false
    setStatus('loading')
    const res = await chooseOfficialSubtitle(track, subtitleId)
    if (!res) {
      setStatus('empty')
      setResult(null)
      return false
    }
    setResult(res)
    setStatus('ok')
    return true
  }, [track])

  const retry = useCallback(() => {
    if (!track) return
    clearLyricCache(track)
    load(track)
  }, [track, load])

  return { status, result, search, choose, retry, listOfficialSubtitles, chooseSubtitle }
}
