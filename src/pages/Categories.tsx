import { Link } from 'react-router-dom'
import {
  Disc3,
  Drum,
  Guitar,
  Headphones,
  Mic2,
  Music2,
  Piano,
  Radio,
  Shapes,
  Sparkles,
  Waves,
} from 'lucide-react'
import {
  MusicPageShell,
  MusicSection,
} from '@/components/AppleMusicPage'

const categories = [
  { label: '经典', keyword: '经典老歌', icon: Disc3, tone: 'rose' },
  { label: '流行', keyword: '流行音乐', icon: Sparkles, tone: 'blue' },
  { label: 'Jpop', keyword: 'Jpop', icon: Headphones, tone: 'violet' },
  { label: '摇滚', keyword: '摇滚', icon: Guitar, tone: 'red' },
  { label: '说唱', keyword: '说唱', icon: Mic2, tone: 'amber' },
  { label: '英文', keyword: '英文歌', icon: Radio, tone: 'cyan' },
  { label: '日文', keyword: '日文歌', icon: Music2, tone: 'pink' },
  { label: '二次元', keyword: '二次元音乐', icon: Sparkles, tone: 'purple' },
  { label: '纯音乐', keyword: '纯音乐', icon: Piano, tone: 'green' },
  { label: '电音', keyword: '电音', icon: Drum, tone: 'indigo' },
  { label: 'Kpop', keyword: 'Kpop', icon: Headphones, tone: 'teal' },
  { label: '古风', keyword: '古风音乐', icon: Shapes, tone: 'orange' },
  { label: '民谣', keyword: '民谣', icon: Guitar, tone: 'lime' },
  { label: '爵士', keyword: '爵士乐', icon: Waves, tone: 'sky' },
] as const

export default function Categories() {
  return (
    <MusicPageShell>
      <section className="category-hero">
        <div>
          <p>音乐分类</p>
          <h1>分类</h1>
          <span>选择一个方向，直接进入对应词条的视频搜索。</span>
        </div>
      </section>

      <MusicSection title="常见分类" icon={<Headphones size={22} />}>
        <div className="category-grid">
          {categories.map((category) => {
            const Icon = category.icon
            const href = `/search?q=${encodeURIComponent(category.keyword)}&type=video`
            return (
              <Link
                key={category.label}
                to={href}
                className={`category-button category-button--${category.tone}`}
                aria-label={`搜索${category.keyword}`}
              >
                <span>
                  <Icon size={30} />
                </span>
                <strong>{category.label}</strong>
              </Link>
            )
          })}
        </div>
      </MusicSection>
    </MusicPageShell>
  )
}
