import { useEffect, useState, useCallback } from 'react'
import { Disc3, Loader2, Play, RefreshCw, TrendingUp } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { extractAudio, getMusicChannelRecommendations, getMusicRanking, type VideoInfo } from '@/services/api'
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
  const [error, setError] = useState<string | null>(null)
  const player = usePlayer()

  useEffect(() => {
    loadMusicRanking()
  }, [])

  async function loadMusicRanking() {
    setLoading(true)
    setError(null)
    try {
      const [featured, rank] = await Promise.all([
        getMusicChannelRecommendations(1, 12),
        getMusicRanking(),
      ])
      const [featuredWithAudio, rankWithAudio] = await Promise.all([
        preloadAudio(featured, 6),
        preloadAudio(rank, 6),
      ])
      setFeaturedTracks(featuredWithAudio)
      setRankTracks(rankWithAudio)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePlayAll = useCallback(() => {
    const playlist = [...featuredTracks, ...rankTracks].slice(0, 18).map(videoToTrack)
    if (playlist.length > 0) player.playAll(playlist)
  }, [featuredTracks, rankTracks, player])

  const handlePlayOne = useCallback((video: VideoInfo) => {
    player.playNow(videoToTrack(video))
  }, [player])

  const featured = featuredTracks.slice(0, 6)
  const list = rankTracks.slice(0, 30)
  const heroImage = featured[0]?.pic
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
          {featured.length > 0 && (
            <MusicSection title="精选推荐" icon={<TrendingUp size={22} />}>
              <FeaturedGrid>
                {featured.map((video, index) => {
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
          )}

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
        </>
      )}
    </MusicPageShell>
  )
}
