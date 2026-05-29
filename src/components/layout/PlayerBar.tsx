import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Heart,
  Volume2,
  VolumeX,
  ListMusic,
  Mic,
  Music,
} from 'lucide-react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { usePlayer } from '@/contexts/PlayerContext'
import { useNowPlaying } from '@/contexts/NowPlayingContext'
import PlayQueue from '@/components/PlayQueue'
import PlayerSlider from '@/components/PlayerSlider'

export default function PlayerBar() {
  const player = usePlayer()
  const { open } = useNowPlaying()
  const [queueOpen, setQueueOpen] = useState(false)
  const trackDuration = player.duration || player.currentTrack?.duration || 0

  return (
    <div
      style={{
        height: 72,
        background: 'var(--glass-bg-heavy)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid var(--glass-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-lg)',
        gap: 'var(--space-lg)',
        flexShrink: 0,
      } as React.CSSProperties}
    >
      {/* Left — Track Info（点击封面/标题进入歌词页，一镜到底）*/}
      <div
        style={{
          width: 220,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div
          onClick={() => { if (player.currentTrack) open() }}
          title={player.currentTrack ? '查看歌词' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: 1,
            minWidth: 0,
            cursor: player.currentTrack ? 'pointer' : 'default',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: player.currentTrack
                ? 'var(--color-card)'
                : 'var(--color-border)',
              overflow: 'hidden',
              border: '1px solid var(--glass-border)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {player.currentTrack?.coverUrl ? (
              <motion.img
                layoutId="np-cover"
                transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                src={player.currentTrack.coverUrl}
                alt={player.currentTrack.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Music size={20} style={{ color: 'var(--color-muted)' }} />
            )}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            {player.currentTrack ? (
              <>
                <motion.div
                  layoutId="np-title"
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="text-body"
                  style={{ color: 'var(--color-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {player.currentTrack.title}
                </motion.div>
                <motion.div
                  layoutId="np-artist"
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="text-caption"
                  style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {player.currentTrack.artist}
                </motion.div>
              </>
            ) : (
              <>
                <div className="text-body" style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>未在播放</div>
                <div className="text-caption" style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>搜索并添加音乐</div>
              </>
            )}
          </div>
        </div>

        {player.currentTrack && (
          <button
            onClick={() => player.toggleLike(player.currentTrack!.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: player.currentTrack.isLiked
                ? 'var(--color-primary)'
                : 'var(--color-muted)',
              padding: 4,
              transition: 'color var(--duration-fast)',
              flexShrink: 0,
            }}
          >
            <Heart
              size={18}
              fill={player.currentTrack.isLiked ? 'currentColor' : 'none'}
            />
          </button>
        )}
      </div>

      {/* Center — Controls + Progress */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          maxWidth: 600,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ControlButton
            icon={<Shuffle size={18} />}
            active={player.isShuffled}
            onClick={() => player.setIsShuffled(!player.isShuffled)}
          />
          <ControlButton icon={<SkipBack size={20} />} onClick={player.prev} />
          <PlayButton isPlaying={player.isPlaying} loading={player.loadingAudio} onClick={player.togglePlay} />
          <ControlButton icon={<SkipForward size={20} />} onClick={player.next} />
          <ControlButton
            icon={<Repeat size={18} />}
            active={player.repeatMode !== 'none'}
            onClick={() => {
              const modes = ['none', 'all', 'one'] as const
              const idx = modes.indexOf(player.repeatMode)
              player.setRepeatMode(modes[(idx + 1) % 3])
            }}
          />
        </div>

        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="text-caption"
            style={{
              color: 'var(--color-muted)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 36,
              textAlign: 'right',
            }}
          >
            {formatTime(player.progress)}
          </span>
          <PlayerSlider
            ariaLabel="播放进度"
            value={player.progress}
            max={trackDuration}
            onChange={player.setProgress}
            disabled={trackDuration <= 0}
            formatValue={formatTime}
            variant="progress"
          />
          <span
            className="text-caption"
            style={{
              color: 'var(--color-muted)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 36,
            }}
          >
            {formatTime(trackDuration)}
          </span>
        </div>
      </div>

      {/* Right — Volume + Extras */}
      <div
        style={{
          width: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => player.setIsMuted(!player.isMuted)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: player.isMuted ? 'var(--color-destructive)' : 'var(--color-muted-foreground)',
            padding: 4,
            transition: 'color var(--duration-fast)',
          }}
        >
          {player.isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <PlayerSlider
          ariaLabel="音量"
          value={player.isMuted ? 0 : player.volume}
          max={100}
          onChange={(value) => {
            player.setVolume(Math.round(value))
            if (player.isMuted && value > 0) player.setIsMuted(false)
          }}
          width={80}
          step={5}
          variant="volume"
        />
        <button
          onClick={() => setQueueOpen(o => !o)}
          title="播放队列"
          style={{
            position: 'relative',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: queueOpen ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
            padding: 4,
            transition: 'color var(--duration-fast)',
          }}
        >
          <ListMusic size={18} />
          {player.queue.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                minWidth: 15,
                height: 15,
                padding: '0 3px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                fontSize: 9,
                fontWeight: 700,
                lineHeight: '15px',
                textAlign: 'center',
              }}
            >
              {player.queue.length}
            </span>
          )}
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', padding: 4 }}>
          <Mic size={18} />
        </button>
      </div>

      <PlayQueue open={queueOpen} onClose={() => setQueueOpen(false)} />
    </div>
  )
}

function PlayButton({ isPlaying, loading, onClick }: { isPlaying: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        width: 40,
        height: 40,
        borderRadius: 'var(--radius-full)',
        background: 'var(--color-accent)',
        color: 'var(--color-on-accent)',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.7 : 1,
        transition: 'transform var(--duration-fast), box-shadow var(--duration-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)'
        e.currentTarget.style.boxShadow = 'var(--shadow-glow)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.boxShadow = 'none'
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      {loading ? (
        <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
      ) : isPlaying ? <Pause size={20} /> : <Play size={20} />}
    </button>
  )
}

function ControlButton({ icon, active = false, onClick }: { icon: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        transition: 'color var(--duration-fast)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--color-primary)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--color-muted-foreground)' }}
    >
      {icon}
    </button>
  )
}

function formatTime(seconds: number): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
