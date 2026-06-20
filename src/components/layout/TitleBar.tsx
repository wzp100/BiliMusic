import { Maximize2, Minimize2, Minus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [query, setQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const useNativeWindowControls = window.electronAPI?.platform === 'openharmony'
  const searchQuery = useMemo(() => {
    if (location.pathname !== '/search') return ''
    return new URLSearchParams(location.search).get('q') || ''
  }, [location.pathname, location.search])

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    api.isMaximized?.().then(setMaximized).catch(() => {})
    return api.onMaximizedChange?.(setMaximized)
  }, [])

  useEffect(() => {
    setQuery(searchQuery)
  }, [searchQuery])

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const keyword = query.trim()
    if (!keyword) {
      navigate('/search')
      return
    }
    navigate(`/search?q=${encodeURIComponent(keyword)}&type=video`)
  }

  return (
    <div className={`app-titlebar ${useNativeWindowControls ? 'app-titlebar--native' : ''}`}>
      <form className="app-titlebar__search" onSubmit={submitSearch}>
        <Search size={15} strokeWidth={2.2} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 B站音乐"
          aria-label="搜索 B站音乐"
        />
      </form>

      {!useNativeWindowControls && (
        <div className="app-titlebar__controls">
          <WindowButton icon={<Minus size={14} />} action="minimize" label="最小化" />
          <WindowButton icon={maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />} action="maximize" label={maximized ? '还原窗口' : '最大化'} />
          <WindowButton icon={<X size={15} />} action="close" label="关闭" isClose />
        </div>
      )}
    </div>
  )
}

function WindowButton({
  icon,
  action,
  label,
  isClose = false,
}: {
  icon: React.ReactNode
  action: 'minimize' | 'maximize' | 'close'
  label: string
  isClose?: boolean
}) {
  const handleClick = () => {
    const api = window.electronAPI
    if (!api) return
    if (action === 'minimize') api.minimize()
    else if (action === 'maximize') api.maximize()
    else if (action === 'close') api.close()
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`app-window-button ${isClose ? 'app-window-button--close' : ''}`}
      onClick={handleClick}
    >
      {icon}
    </button>
  )
}
