import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { LyricLine } from '@/services/lyrics'

interface LyricsViewProps {
  lines: LyricLine[]
  currentTime: number
  synced: boolean
  onSeek: (time: number) => void
}

// 二分：返回最后一个 time <= t 的下标
function activeIndexFor(lines: LyricLine[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let res = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) {
      res = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return res
}

export default function LyricsView({ lines, currentTime, synced, onSeek }: LyricsViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const [y, setY] = useState(0)

  const active = synced ? activeIndexFor(lines, currentTime) : -1
  const posIndex = Math.max(active, 0)

  // 当前行变化 → 计算位移使其垂直居中（spring 动画交给 motion）
  useLayoutEffect(() => {
    if (!synced) return
    const vp = viewportRef.current
    const el = lineRefs.current[posIndex]
    if (!vp || !el) return
    setY(vp.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2))
  }, [posIndex, lines, synced])

  useEffect(() => {
    if (!synced) return
    const recompute = () => {
      const vp = viewportRef.current
      const el = lineRefs.current[posIndex]
      if (!vp || !el) return
      setY(vp.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2))
    }
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [posIndex, synced])

  const fade = 'linear-gradient(to bottom, transparent 0%, #000 16%, #000 84%, transparent 100%)'

  // 无时间戳：静态可滚动列表
  if (!synced) {
    return (
      <div
        style={{
          height: '100%',
          overflowY: 'auto',
          maskImage: fade,
          WebkitMaskImage: fade,
          padding: '12% 4px',
        }}
      >
        {lines.map((l, i) => (
          <p
            key={i}
            style={{
              fontSize: 'clamp(1.2rem, 1.6vw, 1.7rem)',
              fontWeight: 600,
              lineHeight: 1.7,
              color: 'rgba(255,255,255,0.7)',
              margin: '0 0 6px',
            }}
          >
            {l.text}
          </p>
        ))}
      </div>
    )
  }

  // 同步：spring 弹动居中 + 级联高亮
  return (
    <div
      ref={viewportRef}
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      <motion.div
        animate={{ y }}
        transition={{ type: 'spring', stiffness: 95, damping: 20, mass: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
      >
        {lines.map((l, i) => {
          const isActive = i === active
          const dist = Math.abs(i - posIndex)
          return (
            <motion.div
              key={i}
              ref={(el) => { lineRefs.current[i] = el }}
              onClick={() => onSeek(l.time)}
              animate={{
                opacity: isActive ? 1 : 0.3,
                scale: isActive ? 1.06 : 1,
                filter: isActive ? 'blur(0px)' : 'blur(1.4px)',
              }}
              transition={{
                type: 'spring',
                stiffness: 120,
                damping: 22,
                delay: Math.min(dist * 0.025, 0.18),
              }}
              style={{
                transformOrigin: 'left center',
                cursor: 'pointer',
                color: '#fff',
                fontSize: 'clamp(1.4rem, 2vw, 2.1rem)',
                fontWeight: 700,
                lineHeight: 1.45,
                padding: '9px 8px',
                margin: 0,
                textShadow: isActive ? '0 4px 24px rgba(0,0,0,0.35)' : 'none',
              }}
            >
              {l.text}
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}
