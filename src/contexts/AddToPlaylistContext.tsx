import { AnimatePresence, motion } from 'framer-motion'
import { Check, Cloud, Loader2, Music, RefreshCw, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import {
  addTrackToBiliFavorite,
  BILI_FAVORITE_CACHE_TTL_MS,
  getBiliFavoriteFolders,
  type BiliFavoriteFolder,
} from '@/services/biliFavorites'
import { addTrackToPlaylist, loadPlaylists, PLAYLISTS_CHANGED_EVENT } from '@/utils/storage'
import type { Playlist, Track } from '@/types'

interface AddToPlaylistContextValue {
  openAddToPlaylist: (track: Track) => void
}

const AddToPlaylistContext = createContext<AddToPlaylistContextValue | null>(null)

export function AddToPlaylistProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists())
  const [biliFolders, setBiliFolders] = useState<BiliFavoriteFolder[]>([])
  const [biliLoading, setBiliLoading] = useState(false)
  const [biliError, setBiliError] = useState('')
  const [addedId, setAddedId] = useState<string | null>(null)
  const [cloudAddedId, setCloudAddedId] = useState<number | null>(null)
  const [cloudAddingId, setCloudAddingId] = useState<number | null>(null)
  const biliLoadingRef = useRef(false)
  const { isLoggedIn, setShowLogin } = useAuth()

  useEffect(() => {
    const sync = () => setPlaylists(loadPlaylists())
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PLAYLISTS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const close = useCallback(() => {
    setTrack(null)
    setAddedId(null)
    setCloudAddedId(null)
    setCloudAddingId(null)
  }, [])

  const loadCloudFolders = useCallback(async (force = false) => {
    if (biliLoadingRef.current) return
    if (!isLoggedIn) {
      setBiliFolders([])
      setBiliError('')
      return
    }
    biliLoadingRef.current = true
    setBiliLoading(true)
    setBiliError('')
    try {
      const folders = await getBiliFavoriteFolders(undefined, { force })
      setBiliFolders(folders)
      if (!folders.length) setBiliError('当前账号没有可读取的 B站收藏夹。')
    } catch {
      setBiliError('读取 B站收藏夹失败，请稍后再试。')
    } finally {
      biliLoadingRef.current = false
      setBiliLoading(false)
    }
  }, [isLoggedIn])

  const openAddToPlaylist = useCallback((nextTrack: Track) => {
    setPlaylists(loadPlaylists())
    setAddedId(null)
    setCloudAddedId(null)
    setCloudAddingId(null)
    setTrack(nextTrack)
    void loadCloudFolders()
  }, [loadCloudFolders])

  useVisibleInterval(() => {
    void loadCloudFolders(true)
  }, BILI_FAVORITE_CACHE_TTL_MS, Boolean(track && isLoggedIn))

  const choose = useCallback((playlist: Playlist) => {
    if (!track) return
    addTrackToPlaylist(playlist.id, track)
    setAddedId(playlist.id)
    setTimeout(close, 520)
  }, [close, track])

  const chooseCloud = useCallback(async (folder: BiliFavoriteFolder) => {
    if (!track || cloudAddingId) return
    setCloudAddingId(folder.id)
    setBiliError('')
    try {
      await addTrackToBiliFavorite(track, folder.id)
      setCloudAddedId(folder.id)
      setTimeout(close, 620)
    } catch (error) {
      setBiliError(error instanceof Error ? error.message : '加入 B站收藏夹失败，请稍后再试。')
    } finally {
      setCloudAddingId(null)
    }
  }, [close, cloudAddingId, track])

  const loginForCloud = useCallback(() => {
    setShowLogin(true)
  }, [setShowLogin])

  return (
    <AddToPlaylistContext.Provider value={{ openAddToPlaylist }}>
      {children}
      <AnimatePresence>
        {track && (
          <motion.div
            className="add-playlist-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onMouseDown={close}
          >
            <motion.div
              className="add-playlist-popover"
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="add-playlist-popover__head">
                <div>
                  <p>Add to Songlist</p>
                  <h3>添加至歌单</h3>
                </div>
                <button type="button" onClick={close} aria-label="关闭">
                  <X size={17} />
                </button>
              </div>

              <div className="add-playlist-track">
                <div>{track.coverUrl ? <img src={track.coverUrl} alt="" /> : <Music size={20} />}</div>
                <span>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
              </div>

              <div className="add-playlist-list">
                <div className="add-playlist-section-title">
                  <span>本地歌单</span>
                </div>
                {playlists.length === 0 ? (
                  <div className="add-playlist-empty">还没有歌单，请先在侧边栏新建歌单。</div>
                ) : playlists.map((playlist) => {
                  const already = playlist.tracks.some(t => t.id === track.id)
                  const justAdded = addedId === playlist.id
                  return (
                    <button key={playlist.id} type="button" onClick={() => choose(playlist)}>
                      <span>
                        <strong>{playlist.name}</strong>
                        <small>{playlist.tracks.length} 首歌曲</small>
                      </span>
                      {(already || justAdded) && <Check size={16} />}
                    </button>
                  )
                })}

                <div className="add-playlist-section-title">
                  <span>B站云收藏夹</span>
                  {isLoggedIn && (
                    <button type="button" onClick={() => void loadCloudFolders(true)} disabled={biliLoading} title="刷新云收藏夹">
                      {biliLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                    </button>
                  )}
                </div>
                {!isLoggedIn ? (
                  <button type="button" onClick={loginForCloud}>
                    <span>
                      <strong>登录后选择云收藏夹</strong>
                      <small>会加入 B站官方收藏夹，不影响本地歌单</small>
                    </span>
                    <Cloud size={16} />
                  </button>
                ) : biliLoading && !biliFolders.length ? (
                  <div className="add-playlist-empty"><Loader2 size={15} className="spin" /> 正在读取云收藏夹</div>
                ) : biliError ? (
                  <div className="add-playlist-empty">{biliError}</div>
                ) : biliFolders.length === 0 ? (
                  <div className="add-playlist-empty">当前账号没有可读取的 B站收藏夹。</div>
                ) : biliFolders.map((folder) => {
                  const justAdded = cloudAddedId === folder.id
                  const adding = cloudAddingId === folder.id
                  return (
                    <button key={`bili-${folder.id}`} type="button" onClick={() => void chooseCloud(folder)} disabled={Boolean(cloudAddingId)}>
                      <span>
                        <strong>{folder.title}</strong>
                        <small>{folder.mediaCount} 个收藏 · B站云收藏夹</small>
                      </span>
                      {adding ? <Loader2 size={16} className="spin" /> : justAdded ? <Check size={16} /> : <Cloud size={16} />}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AddToPlaylistContext.Provider>
  )
}

export function useAddToPlaylist() {
  const ctx = useContext(AddToPlaylistContext)
  if (!ctx) throw new Error('useAddToPlaylist must be used within AddToPlaylistProvider')
  return ctx
}
