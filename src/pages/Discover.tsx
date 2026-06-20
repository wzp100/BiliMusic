import { useEffect, useState, useCallback, useRef } from 'react'
import { Disc3, Loader2, Play, RefreshCw, TrendingUp } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { RELAXED_SCROLL_REQUEST_GATE, useRequestGate, type RequestGateSource } from '@/hooks/useRequestGate'
import { extractAudio } from '@/services/api'
import { getMusicChannelRecommendations, getMusicRanking, type VideoInfo } from '@/services/biliMusic'
import type { Track } from '@/types'
import {
  ActionButton,
  EmptyLibrary,
  FeaturedGrid,
  FeaturedTrackCard,
  MusicHero,
  MusicPageShell,
  MusicSection,
  TrackList,
  TrackListRow,
} from '@/components/AppleMusicPage'

const FEATURED_PAGE_SIZE = 12
const AUTO_LOAD_ROOT_MARGIN = '560px 0px'

function videoToTrack(video: VideoInfo): Track {
  return {
    id: video.bvid,
    title: video.title,
    artist: video.ownerName,
    coverUrl: video.pic,
    duration: video.duration,
    videoUrl: `https://www.bilibili.com/video/${video.bvid}`,
    bvid: video.bvid,
    audioUrl: video.audioUrl,
    aid: video.aid,
    cid: video.cid,
    playCount: video.stat?.view || 0,
    isLiked: false,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('请求超时')), timeoutMs)
    }),
  ])
}

async function preloadAudio(videos: VideoInfo[], count = 6): Promise<VideoInfo[]> {
  const next = [...videos]
  const targets = next.slice(0, count)
  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3)
    await Promise.all(batch.map(async (video, index) => {
      try {
        const source = await withTimeout(extractAudio(video.bvid, { aid: video.aid, cid: video.cid }), 5000)
        next[i + index] = {
          ...video,
          audioUrl: source.audioUrl,
          duration: video.duration || source.duration,
          cid: video.cid || source.cid,
        }
      } catch {
        // 首屏预取失败不影响列表展示，点击时播放器仍会走原有解析流程。
      }
    }))
  }
  return next
}

export default function Discover() {
  const [featuredTracks, setFeaturedTracks] = useState<VideoInfo[]>([])
  const [rankTracks, setRankTracks] = useState<VideoInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [featuredPage, setFeaturedPage] = useState(1)
  const [featuredHasMore, setFeaturedHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState('')
  const featuredSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const requestGate = useRequestGate(RELAXED_SCROLL_REQUEST_GATE)
  const player = usePlayer()

  useEffect(() => {
    loadMusicRanking()
  }, [])

  async function loadMusicRanking() {
    loadingMoreRef.current = false
    setLoading(true)
    setError(null)
    requestGate.reset()
    try {
      const [featured, rank] = await Promise.all([
        getMusicChannelRecommendations(1, FEATURED_PAGE_SIZE),
        getMusicRanking(),
      ])
      const [featuredWithAudio, rankWithAudio] = await Promise.all([
        preloadAudio(featured, 6),
        preloadAudio(rank, 6),
      ])
      setFeaturedTracks(featuredWithAudio)
      setFeaturedPage(1)
      setFeaturedHasMore(featured.length >= FEATURED_PAGE_SIZE)
      setMoreError('')
      setRankTracks(rankWithAudio)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const loadMoreFeatured = useCallback(async (source: RequestGateSource = 'manual') => {
    if (!featuredHasMore || loadingMore || loading || loadingMoreRef.current) return
    if (!requestGate.canStart(source)) {
      if (source === 'manual') setMoreError('加载太频繁，请稍等一下再试。')
      return
    }
    loadingMoreRef.current = true
    setLoadingMore(true)
    setMoreError('')
    try {
      const nextPage = featuredPage + 1
      const page = await getMusicChannelRecommendations(nextPage, FEATURED_PAGE_SIZE)
      const uniquePage = getUniqueIncomingVideos(featuredTracks, page)
      const pageWithAudio = await preloadAudio(uniquePage, 6)
      const merged = [...featuredTracks, ...pageWithAudio]
      setFeaturedTracks(merged)
      setFeaturedPage(nextPage)
      setFeaturedHasMore(page.length >= FEATURED_PAGE_SIZE && pageWithAudio.length > 0)
    } catch {
      if (source === 'auto') requestGate.markAutoError()
      setMoreError('加载更多精选推荐失败，请稍后再试。')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [featuredHasMore, featuredPage, featuredTracks, loading, loadingMore, requestGate])

  useEffect(() => {
    const sentinel = featuredSentinelRef.current
    if (!sentinel || !featuredHasMore || loading || error) return

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting) {
        loadMoreFeatured('auto')
      }
    }, {
      root: null,
      rootMargin: AUTO_LOAD_ROOT_MARGIN,
      threshold: 0,
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [error, featuredHasMore, loadMoreFeatured, loading])

  const handlePlayAll = useCallback(() => {
    const playlist = [...rankTracks, ...featuredTracks].slice(0, 24).map(videoToTrack)
    if (playlist.length > 0) player.playAll(playlist)
  }, [featuredTracks, rankTracks, player])

  const handlePlayOne = useCallback((video: VideoInfo) => {
    player.playNow(videoToTrack(video))
  }, [player])

  const list = rankTracks.slice(0, 30)
  const heroImage = rankTracks[0]?.pic || featuredTracks[0]?.pic
  const hasTracks = featuredTracks.length > 0 || rankTracks.length > 0

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="B站音乐区排行榜"
        title="发现新声音"
        subtitle="精选热门音乐投稿，用 Apple Music 式的节奏探索今天值得播放的内容。"
        image={heroImage}
        tone="pink"
        action={(
          <ActionButton onClick={handlePlayAll} disabled={loading || !hasTracks}>
            <Play size={17} fill="currentColor" />
            播放全部
          </ActionButton>
        )}
      />

      {loading ? (
        <div className="am-loading"><Loader2 size={30} className="spin" /></div>
      ) : error ? (
        <EmptyLibrary
          icon={<RefreshCw size={38} />}
          title="加载失败"
          subtitle={error}
        />
      ) : (
        <>
          <MusicSection title="热门排行榜" icon={<Disc3 size={22} />}>
            <TrackList>
              {list.map((video, index) => {
                const track = videoToTrack(video)
                return (
                  <TrackListRow
                    key={video.bvid}
                    track={track}
                    index={index + 1}
                    isCurrent={player.currentTrack?.id === video.bvid}
                    isPlaying={player.isPlaying}
                    onPlay={() => handlePlayOne(video)}
                  />
                )
              })}
            </TrackList>
          </MusicSection>

          {featuredTracks.length > 0 && (
            <div className="uniform-card-grid">
              <MusicSection title="精选推荐" icon={<TrendingUp size={22} />}>
                <FeaturedGrid>
                  {featuredTracks.map((video, index) => {
                    const track = videoToTrack(video)
                    return (
                      <FeaturedTrackCard
                        key={video.bvid}
                        track={track}
                        index={index + 1}
                        isCurrent={player.currentTrack?.id === video.bvid}
                        onPlay={() => handlePlayOne(video)}
                      />
                    )
                  })}
                </FeaturedGrid>
              </MusicSection>
            </div>
          )}

          {featuredHasMore && (
            <div className="discover-load-more">
              <ActionButton onClick={() => loadMoreFeatured('manual')} disabled={loadingMore} tone="subtle">
                {loadingMore ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {loadingMore ? '正在加载' : '获取更多精选'}
              </ActionButton>
            </div>
          )}
          <div ref={featuredSentinelRef} className="discover-load-sentinel" aria-hidden="true" />
          {moreError && <div className="discover-load-error">{moreError}</div>}
        </>
      )}
    </MusicPageShell>
  )
}

function getUniqueIncomingVideos(current: VideoInfo[], incoming: VideoInfo[]): VideoInfo[] {
  const seen = new Set(current.map((video) => video.bvid || String(video.aid)))
  return incoming.filter((video) => {
    const key = video.bvid || String(video.aid)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
