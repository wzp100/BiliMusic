import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat,
  Heart, Volume2, VolumeX, Search, Music, Loader2, X,
} from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { useNowPlaying } from '@/contexts/NowPlayingContext'
import { useLyrics } from '@/hooks/useLyrics'
import PlayerSlider from '@/components/PlayerSlider'
import LyricsView from '@/components/LyricsView'
import type { LrclibRecord } from '@/services/lyrics'

const sliderTheme = {
  ['--track-bg']: 'rgba(255,255,255,0.25)',
  ['--track-fill']: '#ffffff',
  ['--track-thumb']: '#ffffff',
} as React.CSSProperties

export default function NowPlaying() {
  const player = usePlayer()
  const { expanded, close } = useNowPlaying()
  const track = player.currentTrack
  const lyrics = useLyrics(track, expanded)
  const duration = player.duration || track?.duration || 0

  // Esc 收起
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, close])

  return (
    <AnimatePresence>
      {expanded && track && (
        <motion.div
          key="now-playing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: '#0a0a0c',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 流光背景：超大模糊封面 + 缓动 */}
          {track.coverUrl && (
            <motion.div
              aria-hidden
              initial={{ scale: 1.15, opacity: 0 }}
              animate={{ scale: 1.25, opacity: 0.55 }}
              transition={{ opacity: { duration: 0.8 }, scale: { duration: 18, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' } }}
              style={{
                position: 'absolute', inset: '-15%',
                backgroundImage: `url(${track.coverUrl})`,
                backgroundSize: 'cover', backgroundPosition: 'center',
                filter: 'blur(90px) saturate(1.7)',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* 暗角 + 渐变压暗，保证文字可读 */}
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(10,10,12,0.35) 0%, rgba(10,10,12,0.82) 100%)', pointerEvents: 'none' }} />

          {/* 顶部条：可拖拽窗口 + 收起 */}
          <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 14px', position: 'relative', zIndex: 3, WebkitAppRegion: 'drag' } as React.CSSProperties}>
            <button
              onClick={close}
              title="收起 (Esc)"
              style={{ ...noDrag, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <ChevronDown size={20} />
            </button>
          </div>

          {/* 主体：左播放面板 + 右歌词 */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: '6%', padding: '0 6% 4%', maxWidth: 1500, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
            {/* 左：播放器 */}
            <div style={{ flex: '0 0 clamp(300px, 30vw, 400px)', maxWidth: 400, display: 'flex', flexDirection: 'column' }}>
              <motion.img
                layoutId="np-cover"
                src={track.coverUrl}
                alt={track.title}
                transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 16, objectFit: 'cover', boxShadow: '0 30px 60px rgba(0,0,0,0.55)', background: 'rgba(255,255,255,0.06)' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 28 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <motion.div
                    layoutId="np-title"
                    transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                    style={{ fontSize: '1.6rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {track.title}
                  </motion.div>
                  <motion.div
                    layoutId="np-artist"
                    transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                    style={{ fontSize: '1.05rem', fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {track.artist}
                  </motion.div>
                </div>
                <button
                  onClick={() => player.toggleLike(track.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: track.isLiked ? 'var(--color-primary)' : 'rgba(255,255,255,0.7)', padding: 4, marginTop: 6, flexShrink: 0 }}
                >
                  <Heart size={22} fill={track.isLiked ? 'currentColor' : 'none'} />
                </button>
              </div>

              {/* 进度 */}
              <div style={{ marginTop: 22, ...sliderTheme }}>
                <PlayerSlider
                  ariaLabel="播放进度"
                  value={player.progress}
                  max={duration}
                  onChange={player.setProgress}
                  disabled={duration <= 0}
                  formatValue={formatTime}
                  variant="progress"
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
                  <span>{formatTime(player.progress)}</span>
                  <span>-{formatTime(Math.max(duration - player.progress, 0))}</span>
                </div>
              </div>

              {/* 控制 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, padding: '0 6px' }}>
                <IconBtn active={player.isShuffled} onClick={() => player.setIsShuffled(!player.isShuffled)}><Shuffle size={20} /></IconBtn>
                <IconBtn onClick={player.prev}><SkipBack size={26} /></IconBtn>
                <button
                  onClick={player.togglePlay}
                  disabled={player.loadingAudio}
                  style={{ width: 64, height: 64, borderRadius: '50%', background: '#fff', color: '#0a0a0c', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: player.loadingAudio ? 'wait' : 'pointer', flexShrink: 0 }}
                >
                  {player.loadingAudio
                    ? <Loader2 size={26} style={{ animation: 'spin 0.8s linear infinite' }} />
                    : player.isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />}
                </button>
                <IconBtn onClick={player.next}><SkipForward size={26} /></IconBtn>
                <IconBtn
                  active={player.repeatMode !== 'none'}
                  onClick={() => {
                    const modes = ['none', 'all', 'one'] as const
                    player.setRepeatMode(modes[(modes.indexOf(player.repeatMode) + 1) % 3])
                  }}
                >
                  <Repeat size={20} />
                  {player.repeatMode === 'one' && <span style={{ position: 'absolute', fontSize: 9, fontWeight: 800, top: -4, right: -4 }}>1</span>}
                </IconBtn>
              </div>

              {/* 音量 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, color: 'rgba(255,255,255,0.6)', ...sliderTheme }}>
                <button onClick={() => player.setIsMuted(!player.isMuted)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}>
                  {player.isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <PlayerSlider
                  ariaLabel="音量"
                  value={player.isMuted ? 0 : player.volume}
                  max={100}
                  step={5}
                  onChange={(v) => { player.setVolume(Math.round(v)); if (player.isMuted && v > 0) player.setIsMuted(false) }}
                  variant="volume"
                />
              </div>
            </div>

            {/* 右：歌词 */}
            <div style={{ flex: 1, minWidth: 0, height: '78vh', display: 'flex', flexDirection: 'column' }}>
              <LyricsPanel lyrics={lyrics} track={track} onSeek={player.setProgress} currentTime={player.progress} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ===== 歌词面板（含状态 + 手动纠正）=====

function LyricsPanel({
  lyrics, track, onSeek, currentTime,
}: {
  lyrics: ReturnType<typeof useLyrics>
  track: { title: string; artist: string }
  onSeek: (t: number) => void
  currentTime: number
}) {
  const { status, result, search, choose, retry } = lyrics
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LrclibRecord[]>([])
  const [searching, setSearching] = useState(false)

  const openSearch = () => {
    setQuery(`${track.title} ${track.artist}`.trim())
    setResults([])
    setSearchOpen(true)
  }
  const doSearch = async () => {
    setSearching(true)
    const r = await search(query)
    setResults(r)
    setSearching(false)
  }

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部小工具条 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, minHeight: 28 }}>
        {(status === 'ok' || status === 'unsynced') && (
          <button onClick={openSearch} style={pillBtn}>
            <Search size={13} /> 歌词不对？
          </button>
        )}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {status === 'loading' && (
          <Centered><Loader2 size={26} style={{ animation: 'spin 0.8s linear infinite' }} /><span style={{ marginTop: 12 }}>匹配歌词中…</span></Centered>
        )}
        {status === 'empty' && (
          <Centered>
            <Music size={40} strokeWidth={1.2} style={{ opacity: 0.6 }} />
            <span style={{ marginTop: 14, fontSize: 16 }}>暂无歌词</span>
            <span style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>这首歌在歌词库里没找到</span>
            <button onClick={openSearch} style={{ ...pillBtn, marginTop: 16 }}><Search size={14} /> 手动搜索歌词</button>
          </Centered>
        )}
        {(status === 'ok' || status === 'unsynced') && result && (
          <>
            {status === 'unsynced' && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>· 该版本无逐行时间轴，按普通歌词显示 ·</div>
            )}
            <div style={{ height: status === 'unsynced' ? 'calc(100% - 24px)' : '100%' }}>
              <LyricsView lines={result.lines} currentTime={currentTime} synced={result.synced} onSeek={onSeek} />
            </div>
          </>
        )}
      </div>

      {/* 手动纠正抽屉 */}
      {searchOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(12,12,14,0.92)', backdropFilter: 'blur(12px)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>手动匹配歌词</span>
            <button onClick={() => setSearchOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
              placeholder="歌名 歌手"
              autoFocus
              style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none' }}
            />
            <button onClick={doSearch} disabled={searching} style={{ ...pillBtn, padding: '8px 16px' }}>
              {searching ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Search size={14} />} 搜索
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.length === 0 && !searching && (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>输入歌名/歌手后搜索</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => { choose(r); setSearchOpen(false) }}
                style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, padding: '10px 12px', color: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{r.trackName}</span>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{r.artistName} · {formatTime(r.duration)}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 11, color: r.syncedLyrics ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>
                  {r.syncedLyrics ? '同步' : r.plainLyrics ? '纯文本' : '无'}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => { retry(); setSearchOpen(false) }} style={{ ...pillBtn, marginTop: 12, justifyContent: 'center' }}>重新自动匹配</button>
        </div>
      )}
    </div>
  )
}

// ===== 小组件/样式 =====

function IconBtn({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', color: active ? 'var(--color-primary)' : 'rgba(255,255,255,0.85)', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.8)' }}>
      {children}
    </div>
  )
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 9999,
  color: '#fff', fontSize: 13, padding: '6px 12px', cursor: 'pointer',
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
