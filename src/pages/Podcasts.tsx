import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Play, Podcast, RefreshCw, Radio } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { RELAXED_SCROLL_REQUEST_GATE, useRequestGate, type RequestGateSource } from '@/hooks/useRequestGate'
import { getFollowingDynamicVideos, type DynamicVideo } from '@/services/biliDynamics'
import type { Track } from '@/types'
import {
  ActionButton,
  EmptyLibrary,
  FeaturedGrid,
  FeaturedTrackCard,
  MusicHero,
  MusicPageShell,
  MusicSection,
} from '@/components/AppleMusicPage'

const PAGE_SIZE = 24
const MAX_TARGETED_LOAD_PAGES = 6
const AUTO_LOAD_ROOT_MARGIN = '520px 0px'

function dynamicVideoToTrack(video: DynamicVideo): Track {
  return {
    id: `dynamic-${video.bvid}`,
    title: video.title,
    artist: video.author,
    coverUrl: video.coverUrl,
    duration: video.duration,
    videoUrl: `https://www.bilibili.com/video/${video.bvid}`,
    bvid: video.bvid,
    audioUrl: video.audioUrl,
    aid: video.aid,
    cid: video.cid,
    playCount: video.playCount,
    isLiked: false,
  }
}

export default function Podcasts() {
  const dateOptions = useMemo(() => buildDateOptions(), [])
  const [videos, setVideos] = useState<DynamicVideo[]>([])
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateOptions[0].key)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState('')
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const requestGate = useRequestGate(RELAXED_SCROLL_REQUEST_GATE)
  const player = usePlayer()

  useEffect(() => {
    loadVideos()
  }, [])

  async function loadVideos() {
    setLoading(true)
    setError(null)
    setMoreError('')
    requestGate.reset()
    try {
      const page = await getFollowingDynamicVideos(PAGE_SIZE)
      setVideos(page.videos)
      setHasMore(page.hasMore)
      setOffset(page.offset)
    } catch {
      setError('无法加载动态视频，请确认已登录 B 站账号。')
    } finally {
      setLoading(false)
    }
  }

  const loadMore = useCallback(async (source: RequestGateSource = 'manual') => {
    if (!hasMore || !offset || loadingMore || loadingMoreRef.current) return
    if (!requestGate.canStart(source)) {
      if (source === 'manual') setMoreError('加载太频繁，请稍等一下再试。')
      return
    }
    loadingMoreRef.current = true
    setLoadingMore(true)
    setMoreError('')
    try {
      const targetDateKey = selectedDateKey
      const shouldChaseDate = targetDateKey !== dateOptions[0].key
      let nextOffset = offset
      let nextHasMore = hasMore
      let loadedPages = 0
      const loadedVideos: DynamicVideo[] = []

      while (nextHasMore && nextOffset && loadedPages < (shouldChaseDate ? MAX_TARGETED_LOAD_PAGES : 1)) {
        const page = await getFollowingDynamicVideos(PAGE_SIZE, nextOffset, { preloadAudio: false })
        loadedPages += 1
        loadedVideos.push(...page.videos)
        nextHasMore = page.hasMore
        nextOffset = page.offset

        if (!shouldChaseDate) break
        if (page.videos.some((video) => dateKeyForVideo(video) === targetDateKey)) break
        if (pageHasPassedDate(page.videos, targetDateKey)) break
      }

      if (loadedVideos.length > 0) {
        setVideos((current) => mergeUniqueVideos(current, loadedVideos))
      }
      setHasMore(nextHasMore)
      setOffset(nextOffset)
    } catch {
      if (source === 'auto') requestGate.markAutoError()
      setMoreError('加载更多动态失败，请稍后再试。')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [dateOptions, hasMore, loadingMore, offset, requestGate, selectedDateKey])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
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

  const handlePlay = useCallback((video: DynamicVideo) => {
    player.playNow(dynamicVideoToTrack(video))
  }, [player])

  const handlePlayAll = useCallback(() => {
    if (videos.length === 0) return
    player.playAll(videos.map(dynamicVideoToTrack))
  }, [player, videos])

  const heroVideo = videos[0]
  const selectedDate = dateOptions.find((option) => option.key === selectedDateKey) || dateOptions[0]
  const visibleVideos = useMemo(() => {
    return videos.filter((video) => dateKeyForVideo(video) === selectedDateKey)
  }, [selectedDateKey, videos])

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Podcast"
        title="播客"
        subtitle="从你关注的 B站动态中筛出视频内容，像播客一样连续收听。"
        image={heroVideo?.coverUrl}
        tone="purple"
        action={(
          <ActionButton onClick={handlePlayAll} disabled={loading || videos.length === 0}>
            <Play size={17} fill="currentColor" />
            播放动态
          </ActionButton>
        )}
      />

      {loading ? (
        <div className="am-loading"><Loader2 size={30} className="spin" /></div>
      ) : error ? (
        <EmptyLibrary icon={<RefreshCw size={38} />} title="加载失败" subtitle={error} />
      ) : videos.length === 0 ? (
        <EmptyLibrary icon={<Radio size={38} />} title="暂无动态视频" subtitle="登录后，这里会显示你关注的人发布的视频动态。" />
      ) : (
        <>
          <div className="podcasts-date-filter" aria-label="选择动态日期">
            {dateOptions.map((option) => (
              <button
                type="button"
                key={option.key}
                className={option.key === selectedDateKey ? 'is-active' : ''}
                onClick={() => setSelectedDateKey(option.key)}
              >
                <strong>{option.label}</strong>
                <small>{option.dateText}</small>
              </button>
            ))}
          </div>

          {visibleVideos.length > 0 ? (
            <div className="uniform-card-grid">
              <MusicSection title={selectedDate.label} icon={<Podcast size={22} />}>
                <FeaturedGrid>
                  {visibleVideos.map((video) => {
                    const track = dynamicVideoToTrack(video)
                    const index = videos.findIndex((item) => item.id === video.id) + 1
                    return (
                      <FeaturedTrackCard
                        key={video.id}
                        track={track}
                        index={index}
                        isCurrent={player.currentTrack?.id === track.id}
                        onPlay={() => handlePlay(video)}
                      />
                    )
                  })}
                </FeaturedGrid>
              </MusicSection>
            </div>
          ) : (
            <EmptyLibrary
              icon={<Radio size={38} />}
              title={`${selectedDate.label}暂无动态视频`}
              subtitle="可以切换日期，或继续加载更早的动态。"
            />
          )}

          {hasMore && (
            <div className="podcasts-load-more">
              <ActionButton onClick={() => loadMore('manual')} disabled={loadingMore} tone="subtle">
                {loadingMore ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {loadingMore ? '正在加载' : '获取更多'}
              </ActionButton>
            </div>
          )}
          <div
            ref={loadMoreSentinelRef}
            className="podcasts-load-sentinel"
            aria-hidden="true"
          />
          {moreError && <div className="podcasts-load-error">{moreError}</div>}
        </>
      )}
    </MusicPageShell>
  )
}

interface DateOption {
  key: string
  label: string
  dateText: string
}

function buildDateOptions(): DateOption[] {
  const today = new Date()
  return [
    { label: '今天', offset: 0 },
    { label: '昨天', offset: 1 },
    { label: '前天', offset: 2 },
  ].map((item) => {
    const date = new Date(today)
    date.setDate(today.getDate() - item.offset)
    return {
      key: formatDateKey(date),
      label: item.label,
      dateText: formatDateLabel(date),
    }
  })
}

function dateKeyForVideo(video: DynamicVideo): string {
  const date = new Date((video.publishedAt || 0) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return formatDateKey(date)
}

function mergeUniqueVideos(current: DynamicVideo[], incoming: DynamicVideo[]): DynamicVideo[] {
  const seen = new Set(current.map((video) => video.id || video.bvid))
  const next = incoming.filter((video) => {
    const key = video.id || video.bvid
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...current, ...next]
}

function pageHasPassedDate(videos: DynamicVideo[], targetDateKey: string): boolean {
  return videos.some((video) => {
    const key = dateKeyForVideo(video)
    return key !== '' && key < targetDateKey
  })
}

function formatDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find(part => part.type === 'year')?.value || '0000'
  const month = parts.find(part => part.type === 'month')?.value || '00'
  const day = parts.find(part => part.type === 'day')?.value || '00'
  return `${year}-${month}-${day}`
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
