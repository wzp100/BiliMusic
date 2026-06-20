import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock3, Loader2, Play, RefreshCw } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { RELAXED_SCROLL_REQUEST_GATE, useRequestGate, type RequestGateSource } from '@/hooks/useRequestGate'
import {
  getBiliHistory,
  type BiliHistoryCursor,
} from '@/services/biliHistory'
import type { Track } from '@/types'
import {
  ActionButton,
  EmptyLibrary,
  MusicHero,
  MusicPageShell,
  MusicSection,
  TrackList,
  TrackListRow,
} from '@/components/AppleMusicPage'

const PAGE_SIZE = 30
const AUTO_LOAD_ROOT_MARGIN = '520px 0px'

export default function History() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [cursor, setCursor] = useState<BiliHistoryCursor>({})
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState('')
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const requestGate = useRequestGate(RELAXED_SCROLL_REQUEST_GATE)
  const player = usePlayer()

  const loadFirstPage = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    setMoreError('')
    requestGate.reset()
    try {
      const page = await getBiliHistory({}, PAGE_SIZE, { force })
      setTracks(page.tracks)
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch (e: any) {
      setError(e.message || '无法加载 B站历史记录，请确认已登录。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFirstPage()
  }, [loadFirstPage])

  const loadMore = useCallback(async (source: RequestGateSource = 'manual') => {
    if (!hasMore || loading || loadingMore || loadingMoreRef.current) return
    if (!requestGate.canStart(source)) {
      if (source === 'manual') setMoreError('加载太频繁，请稍等一下再试。')
      return
    }
    loadingMoreRef.current = true
    setLoadingMore(true)
    setMoreError('')
    try {
      const page = await getBiliHistory(cursor, PAGE_SIZE)
      setTracks((current) => mergeUniqueTracks(current, page.tracks))
      setCursor(page.cursor)
      setHasMore(page.hasMore && page.tracks.length > 0)
    } catch {
      if (source === 'auto') requestGate.markAutoError()
      setMoreError('加载更多历史记录失败，请稍后再试。')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [cursor, hasMore, loading, loadingMore, requestGate])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || loading || error) return

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting) {
        loadMore('auto')
      }
    }, {
      root: null,
      rootMargin: AUTO_LOAD_ROOT_MARGIN,
      threshold: 0,
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [error, hasMore, loadMore, loading])

  const handlePlayAll = useCallback(() => {
    if (tracks.length > 0) player.playAll(tracks)
  }, [player, tracks])

  const heroImage = tracks[0]?.coverUrl

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Bilibili History"
        title="历史记录"
        subtitle={tracks.length ? `同步 B站官方历史记录，包含其它端播放过的 ${tracks.length} 条内容。` : '这里显示 B站官方账号历史记录，和本软件最近播放分开保存。'}
        image={heroImage}
        tone="blue"
        action={(
          <>
            <ActionButton onClick={handlePlayAll} disabled={loading || tracks.length === 0}>
              <Play size={17} fill="currentColor" />
              播放全部
            </ActionButton>
            <ActionButton onClick={() => loadFirstPage(true)} disabled={loading} tone="subtle">
              {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              刷新
            </ActionButton>
          </>
        )}
      />

      {loading ? (
        <div className="am-loading"><Loader2 size={30} className="spin" /></div>
      ) : error ? (
        <EmptyLibrary icon={<RefreshCw size={38} />} title="加载失败" subtitle={error} />
      ) : tracks.length === 0 ? (
        <EmptyLibrary icon={<Clock3 size={38} />} title="暂无历史记录" subtitle="登录 B站账号后，这里会显示官方历史记录。" />
      ) : (
        <>
          <MusicSection title="B站官方历史" icon={<Clock3 size={22} />}>
            <TrackList>
              {tracks.map((track, index) => (
                <TrackListRow
                  key={`${track.id}-${index}`}
                  track={track}
                  index={index + 1}
                  isCurrent={player.currentTrack?.id === track.id}
                  isPlaying={player.isPlaying}
                  onPlay={() => player.playNow(track)}
                />
              ))}
            </TrackList>
          </MusicSection>

          {hasMore && (
            <div className="history-load-more">
              <ActionButton onClick={() => loadMore('manual')} disabled={loadingMore} tone="subtle">
                {loadingMore ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {loadingMore ? '正在加载' : '加载更多'}
              </ActionButton>
            </div>
          )}
          <div ref={sentinelRef} className="history-load-sentinel" aria-hidden="true" />
          {moreError && <div className="history-load-error">{moreError}</div>}
        </>
      )}
    </MusicPageShell>
  )
}

function mergeUniqueTracks(current: Track[], incoming: Track[]): Track[] {
  const seen = new Set(current.map((track) => track.bvid || track.id))
  const next = incoming.filter((track) => {
    const key = track.bvid || track.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...current, ...next]
}
