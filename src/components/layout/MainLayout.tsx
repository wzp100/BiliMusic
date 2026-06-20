import { Outlet } from 'react-router-dom'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import PlayerBar from './PlayerBar'
import NowPlaying from '@/components/NowPlaying'

export default function MainLayout() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Sidebar />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <TitleBar />

          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              background: 'var(--color-background)',
              padding: 'var(--space-lg) var(--space-xl)',
            }}
          >
            <Outlet />
          </main>
        </div>
      </div>

      <PlayerBar />

      <NowPlaying />
    </div>
  )
}
