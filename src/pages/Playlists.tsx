import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckSquare, Cloud, FolderPlus, ListMusic, Loader2, Music, Play, RefreshCw, Square, Trash2, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePlayer } from '@/contexts/PlayerContext'
import { useRequestGate, type RequestGateSource } from '@/hooks/useRequestGate'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import TrackActions from '@/components/TrackActions'
import {
  EmptyLibrary,
  MusicHero,
  MusicPageShell,
  MusicSection,
  TrackList,
  TrackListRow,
} from '@/components/AppleMusicPage'
import {
  BILI_FAVORITE_CACHE_TTL_MS,
  getBiliFavoriteFolderTracks,
  getBiliFavoriteFolders,
  type BiliFavoriteFolder,
} from '@/services/biliFavorites'
import type { Track } from '@/types'
import {
  addTracksToPlaylist,
  deletePlaylist,
  getPlaylist,
  loadPlaylists,
  PLAYLISTS_CHANGED_EVENT,
  removeTracksFromPlaylist,
} from '@/utils/storage'
import type { Playlist } from '@/types'

const BILI_FAVORITE_PAGE_SIZE = 40
const AUTO_LOAD_ROOT_MARGIN = '520px 0px'
const AUTO_LOAD_INTERVAL_MS = 500
const AUTO_LOAD_ERROR_COOLDOWN_MS = 30000
const MANUAL_LOAD_INTERVAL_MS = 500

export default function Playlists() {
  const { playlistId, favoriteId } = useParams()
  if (favoriteId) return <BiliFavoriteDetail favoriteId={Number(favoriteId)} />
  return playlistId ? <PlaylistDetail playlistId={playlistId} /> : <PlaylistOverview />
}

function PlaylistOverview() {
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists())
  const [biliFolders, setBiliFolders] = useState<BiliFavoriteFolder[]>([])
  const [biliLoading, setBiliLoading] = useState(false)
  const [biliError, setBiliError] = useState('')
  const biliLoadingRef = useRef(false)
  const { isLoggedIn } = useAuth()

  useEffect(() => {
    const sync = () => setPlaylists(loadPlaylists())
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PLAYLISTS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const loadBiliFolders = useCallback(async (force = false) => {
    if (biliLoadingRef.current) return
    if (!isLoggedIn) {
      setBiliFolders([])
      return
    }
    biliLoadingRef.current = true
    setBiliLoading(true)
    setBiliError('')
    try {
      const folders = await getBiliFavoriteFolders(undefined, { force })
      setBiliFolders(folders)
    } catch {
      setBiliError('读取 B站收藏夹失败，请确认账号已登录且收藏夹可访问。')
    } finally {
      biliLoadingRef.current = false
      setBiliLoading(false)
    }
  }, [isLoggedIn])

  useEffect(() => {
    void loadBiliFolders()
  }, [loadBiliFolders])

  useVisibleInterval(() => {
    void loadBiliFolders(true)
  }, BILI_FAVORITE_CACHE_TTL_MS, isLoggedIn)

  const heroImage = biliFolders.find(folder => folder.coverUrl)?.coverUrl || playlists.find(p => p.coverUrl)?.coverUrl

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="All Songlists"
        title="所有歌单"
        subtitle={`B站收藏夹和本地歌单会一起显示在这里。${playlists.length ? `你创建了 ${playlists.length} 个本地歌单。` : ''}`}
        image={heroImage}
        tone="purple"
      />

      {!isLoggedIn ? (
        <EmptyLibrary
          icon={<Cloud size={40} />}
          title="登录后显示 B站收藏夹"
          subtitle="登录 Bilibili 后，这里会把你的 B站收藏夹和本地歌单合在一起展示。"
        />
      ) : (
        <MusicSection title="B站收藏夹" icon={<Cloud size={22} />}>
          <div className="playlist-editbar">
            <div>
              <span>{biliLoading ? '正在读取收藏夹' : `${biliFolders.length} 个收藏夹`}</span>
            </div>
            <button type="button" className="playlist-editbar__primary" onClick={() => void loadBiliFolders(true)}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
          {biliError ? (
            <EmptyLibrary icon={<Cloud size={40} />} title="读取失败" subtitle={biliError} />
          ) : biliFolders.length === 0 && !biliLoading ? (
            <EmptyLibrary icon={<Cloud size={40} />} title="暂无 B站收藏夹" subtitle="当前账号没有可读取的收藏夹，或收藏夹权限不可访问。" />
          ) : (
            <div className="playlist-grid">
              {biliFolders.map((folder) => (
                <BiliFavoriteCard key={folder.id} folder={folder} />
              ))}
            </div>
          )}
        </MusicSection>
      )}

      {playlists.length === 0 ? (
        <MusicSection title="本地歌单" icon={<ListMusic size={22} />}>
          <EmptyLibrary icon={<ListMusic size={40} />} title="还没有本地歌单" subtitle="新建歌单后，会立即显示在这里和侧边栏中。" />
        </MusicSection>
      ) : (
        <MusicSection title="本地歌单" icon={<ListMusic size={22} />}>
          <div className="playlist-grid">
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </MusicSection>
      )}
    </MusicPageShell>
  )
}

function BiliFavoriteCard({ folder }: { folder: BiliFavoriteFolder }) {
  return (
    <Link to={`/playlists/bili/${folder.id}`} className="playlist-card">
      <div className="playlist-card__cover">
        {folder.coverUrl ? <img src={folder.coverUrl} alt="" loading="lazy" /> : <Cloud size={34} />}
      </div>
      <div className="playlist-card__body">
        <h3>{folder.title}</h3>
        <p>{folder.mediaCount} 个收藏</p>
        <span>B站收藏夹</span>
      </div>
    </Link>
  )
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const cover = playlist.coverUrl || playlist.tracks[0]?.coverUrl
  return (
    <Link to={`/playlists/${playlist.id}`} className="playlist-card">
      <div className="playlist-card__cover">
        {cover ? <img src={cover} alt="" loading="lazy" /> : <Music size={34} />}
      </div>
      <div className="playlist-card__body">
        <h3>{playlist.name}</h3>
        <p>{playlist.tracks.length} 首歌曲</p>
        {playlist.description && <span>{playlist.description}</span>}
      </div>
    </Link>
  )
}

function PlaylistDetail({ playlistId }: { playlistId: string }) {
  const [playlist, setPlaylist] = useState<Playlist | null>(() => getPlaylist(playlistId))
  const [editing, setEditing] = useState(false)
  const [importingBili, setImportingBili] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const player = usePlayer()
  const navigate = useNavigate()
  const { isLoggedIn, setShowLogin } = useAuth()

  useEffect(() => {
    const sync = () => setPlaylist(getPlaylist(playlistId))
    sync()
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PLAYLISTS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [playlistId])

  const tracks = playlist?.tracks || []
  const heroImage = playlist?.coverUrl || tracks[0]?.coverUrl
  const updatedText = useMemo(() => {
    if (!playlist?.updatedAt) return ''
    return new Date(playlist.updatedAt).toLocaleDateString()
  }, [playlist?.updatedAt])

  if (!playlist) {
    return (
      <MusicPageShell>
        <EmptyLibrary icon={<ListMusic size={40} />} title="歌单不存在" subtitle="这个歌单可能已经被删除。" />
      </MusicPageShell>
    )
  }

  const handleDelete = () => {
    deletePlaylist(playlist.id)
    navigate('/playlists')
  }

  const removeSelected = () => {
    if (selectedIds.size === 0) return
    const updated = removeTracksFromPlaylist(playlist.id, [...selectedIds])
    setPlaylist(updated)
    setSelectedIds(new Set())
    setEditing(false)
  }

  const removeOne = (trackId: string) => {
    const updated = removeTracksFromPlaylist(playlist.id, [trackId])
    setPlaylist(updated)
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })
  }

  const toggleSelected = (trackId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const allSelected = tracks.length > 0 && selectedIds.size === tracks.length
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(tracks.map(track => track.id)))
  }

  const toggleEditing = () => {
    setEditing(prev => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Songlist"
        title={playlist.name}
        subtitle={playlist.description || `${tracks.length} 首歌曲${updatedText ? ` · 更新于 ${updatedText}` : ''}`}
        image={heroImage}
        tone="purple"
        action={(
          <>
            {tracks.length > 0 && (
              <button className="am-action am-action--primary" onClick={() => player.playAll(tracks)}>
                <Play size={17} fill="currentColor" />
                播放全部
              </button>
            )}
            <button className="am-action am-action--subtle" onClick={handleDelete}>
              <Trash2 size={16} />
              删除歌单
            </button>
            <button
              className="am-action am-action--subtle"
              onClick={() => isLoggedIn ? setImportingBili(true) : setShowLogin(true)}
            >
              <FolderPlus size={16} />
              从收藏夹添加
            </button>
          </>
        )}
      />

      {tracks.length === 0 ? (
        <EmptyLibrary icon={<Music size={40} />} title="歌单是空的" subtitle="歌单已经创建并持久化保存，后续可以把歌曲加入到这里。" />
      ) : (
        <MusicSection title="歌曲" icon={<Music size={22} />}>
          <div className={`playlist-editbar ${editing ? 'is-editing' : ''}`}>
            <div>
              <span>{editing ? `已选择 ${selectedIds.size} 首` : `${tracks.length} 首歌曲`}</span>
            </div>
            {editing && (
              <button type="button" onClick={toggleAll}>
                {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
            )}
            {editing && selectedIds.size > 0 && (
              <button type="button" className="playlist-editbar__danger" onClick={removeSelected}>
                <Trash2 size={16} />
                移出歌单
              </button>
            )}
            <button type="button" className="playlist-editbar__primary" onClick={toggleEditing}>
              {editing ? '完成' : '选择'}
            </button>
          </div>
          <TrackList>
            {tracks.map((track, index) => (
              <TrackListRow
                key={track.id + String(index)}
                track={track}
                index={index + 1}
                isCurrent={player.currentTrack?.id === track.id}
                isPlaying={player.isPlaying}
                onPlay={() => editing ? toggleSelected(track.id) : player.playNow(track)}
                leading={editing ? (
                  <button
                    type="button"
                    className={`playlist-select-button ${selectedIds.has(track.id) ? 'is-selected' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleSelected(track.id) }}
                    title={selectedIds.has(track.id) ? '取消选择' : '选择'}
                  >
                    {selectedIds.has(track.id) ? <CheckSquare size={17} /> : <Square size={17} />}
                  </button>
                ) : undefined}
                extra={(
                  <div className="am-extra-actions">
                    {!editing && <TrackActions track={track} size={15} />}
                    {!editing && (
                      <button className="am-icon-danger" onClick={(e) => { e.stopPropagation(); removeOne(track.id) }} title="移出歌单">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                )}
              />
            ))}
          </TrackList>
        </MusicSection>
      )}
    </MusicPageShell>
  )
}

function BiliFavoriteImportDialog({
  playlist,
  onClose,
  onAdd,
}: {
  playlist: Playlist
  onClose: () => void
  onAdd: (tracks: Track[]) => void
}) {
  const [folders, setFolders] = useState<BiliFavoriteFolder[]>([])
  const [activeFolder, setActiveFolder] = useState<BiliFavoriteFolder | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [loadingFolders, setLoadingFolders] = useState(true)
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoadingFolders(true)
    getBiliFavoriteFolders()
      .then((items) => {
        if (!alive) return
        setFolders(items)
        setError(items.length ? '' : '当前账号没有可读取的 B站收藏夹。')
      })
      .catch(() => {
        if (alive) setError('读取 B站收藏夹失败，请稍后再试。')
      })
      .finally(() => {
        if (alive) setLoadingFolders(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const loadFolderTracks = async (folder: BiliFavoriteFolder, force = false) => {
    setActiveFolder(folder)
    setTracks([])
    setSelectedIds(new Set())
    setLoadingTracks(true)
    setError('')
    try {
      const result = await getBiliFavoriteFolderTracks(folder.id, 1, 40, { force })
      setTracks(result.tracks)
      if (!result.tracks.length) setError('这个收藏夹里没有可加入的公开视频。')
    } catch {
      setError('读取收藏夹内容失败，请确认该收藏夹存在且当前账号有权限访问。')
    } finally {
      setLoadingTracks(false)
    }
  }

  const existingIds = useMemo(() => new Set(playlist.tracks.map(track => track.id)), [playlist.tracks])
  const existingBvids = useMemo(() => new Set(playlist.tracks.map(track => track.bvid).filter(Boolean)), [playlist.tracks])
  const selectableTracks = tracks.filter(track => !existingIds.has(track.id) && !existingBvids.has(track.bvid))
  const selectedTracks = selectableTracks.filter(track => selectedIds.has(track.id))
  const allSelected = selectableTracks.length > 0 && selectedIds.size === selectableTracks.length

  const toggleTrack = (track: Track) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(track.id)) next.delete(track.id)
      else next.add(track.id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableTracks.map(track => track.id)))
  }

  return (
    <div className="bili-import-backdrop" onMouseDown={onClose}>
      <div className="bili-import-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="bili-import-head">
          <div>
            <p>Bilibili Favorites</p>
            <h2>从收藏夹添加</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="bili-import-body">
          <aside className="bili-import-folders">
            {loadingFolders ? (
              <div className="bili-import-muted"><Loader2 size={16} className="spin" /> 正在读取收藏夹</div>
            ) : folders.map((folder) => (
              <button
                type="button"
                key={folder.id}
                className={activeFolder?.id === folder.id ? 'is-active' : ''}
                onClick={() => void loadFolderTracks(folder)}
              >
                <strong>{folder.title}</strong>
                <small>{folder.mediaCount} 个视频</small>
              </button>
            ))}
          </aside>

          <section className="bili-import-tracks">
            <div className="bili-import-toolbar">
              <span>{activeFolder ? activeFolder.title : '选择一个 B站收藏夹'}</span>
              <div>
                {activeFolder && (
                  <button type="button" onClick={() => void loadFolderTracks(activeFolder, true)} disabled={loadingTracks}>
                    <RefreshCw size={14} />
                    刷新
                  </button>
                )}
                {selectableTracks.length > 0 && (
                  <button type="button" onClick={toggleAll}>
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                )}
              </div>
            </div>

            {loadingTracks ? (
              <div className="bili-import-empty"><Loader2 size={18} className="spin" /> 正在读取视频</div>
            ) : error ? (
              <div className="bili-import-empty">{error}</div>
            ) : !activeFolder ? (
              <div className="bili-import-empty">先从左侧选择一个收藏夹。</div>
            ) : tracks.length === 0 ? (
              <div className="bili-import-empty">这个收藏夹里没有可加入的视频。</div>
            ) : (
              <div className="bili-import-list">
                {tracks.map((track) => {
                  const duplicate = existingIds.has(track.id) || existingBvids.has(track.bvid)
                  const selected = selectedIds.has(track.id)
                  return (
                    <button
                      type="button"
                      key={track.id}
                      className={`${selected ? 'is-selected' : ''} ${duplicate ? 'is-disabled' : ''}`}
                      disabled={duplicate}
                      onClick={() => toggleTrack(track)}
                    >
                      <span>{track.coverUrl ? <img src={track.coverUrl} alt="" /> : <Music size={18} />}</span>
                      <strong>{track.title}</strong>
                      <small>{duplicate ? '已在歌单中' : track.artist}</small>
                      {selected && <CheckSquare size={17} />}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className="bili-import-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" disabled={!selectedTracks.length} onClick={() => onAdd(selectedTracks)}>
            添加 {selectedTracks.length} 个视频
          </button>
        </div>
      </div>
    </div>
  )
}

function BiliFavoriteDetail({ favoriteId }: { favoriteId: number }) {
  const [folder, setFolder] = useState<BiliFavoriteFolder | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const requestGate = useRequestGate({
    autoIntervalMs: AUTO_LOAD_INTERVAL_MS,
    manualIntervalMs: MANUAL_LOAD_INTERVAL_MS,
    autoErrorCooldownMs: AUTO_LOAD_ERROR_COOLDOWN_MS,
  })
  const player = usePlayer()
  const { isLoggedIn, setShowLogin } = useAuth()

  const loadTracks = useCallback(async (force = false) => {
    if (loadingRef.current) return
    loadingMoreRef.current = false
    if (!Number.isFinite(favoriteId) || favoriteId <= 0) {
      setLoading(false)
      setError('收藏夹地址无效。')
      return
    }
    if (!isLoggedIn) {
      setLoading(false)
      setError('需要先登录 Bilibili 才能读取收藏夹。')
      return
    }
    loadingRef.current = true
    setLoading(true)
    setError('')
    setMoreError('')
    requestGate.reset()
    try {
      const result = await getBiliFavoriteFolderTracks(favoriteId, 1, BILI_FAVORITE_PAGE_SIZE, { force })
      setFolder(result.info || null)
      setTracks(result.tracks)
      setPage(1)
      setHasMore(result.hasMore && result.tracks.length > 0)
    } catch {
      setError('读取收藏夹内容失败，请确认该收藏夹存在且当前账号有权限访问。')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [favoriteId, isLoggedIn, requestGate])

  useEffect(() => {
    void loadTracks()
  }, [loadTracks])

  useVisibleInterval(() => {
    void loadTracks(true)
  }, BILI_FAVORITE_CACHE_TTL_MS, isLoggedIn && Number.isFinite(favoriteId) && favoriteId > 0)

  const loadMoreTracks = useCallback(async (source: RequestGateSource = 'manual') => {
    if (!hasMore || loading || loadingRef.current || loadingMoreRef.current) return
    if (!requestGate.canStart(source)) {
      if (source === 'manual') setMoreError('加载太频繁，请稍等一下再试。')
      return
    }

    loadingMoreRef.current = true
    setLoadingMore(true)
    setMoreError('')
    try {
      const nextPage = page + 1
      const result = await getBiliFavoriteFolderTracks(favoriteId, nextPage, BILI_FAVORITE_PAGE_SIZE)
      setFolder((current) => result.info || current)
      setTracks((current) => mergeUniqueTracks(current, result.tracks))
      setPage(nextPage)
      setHasMore(result.hasMore && result.tracks.length > 0)
    } catch {
      if (source === 'auto') requestGate.markAutoError()
      setMoreError('加载更多收藏内容失败，请稍后再试。')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [favoriteId, hasMore, loading, page, requestGate])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || loading || error) return

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting) {
        loadMoreTracks('auto')
      }
    }, {
      root: null,
      rootMargin: AUTO_LOAD_ROOT_MARGIN,
      threshold: 0,
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [error, hasMore, loadMoreTracks, loading])

  const heroImage = folder?.coverUrl || tracks[0]?.coverUrl
  const title = folder?.title || 'B站收藏夹'
  const subtitle = loading
    ? '正在读取 B站收藏夹内容。'
    : folder?.description || `${tracks.length} 个可播放视频 · 来自 B站收藏夹`

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Bilibili Favorite"
        title={title}
        subtitle={subtitle}
        image={heroImage}
        tone="blue"
        action={(
          <>
            {tracks.length > 0 && (
              <button className="am-action am-action--primary" onClick={() => player.playAll(tracks)}>
                <Play size={17} fill="currentColor" />
                播放全部
              </button>
            )}
            <button className="am-action am-action--subtle" onClick={isLoggedIn ? () => void loadTracks(true) : () => setShowLogin(true)}>
              <RefreshCw size={16} />
              {isLoggedIn ? '刷新' : '登录'}
            </button>
          </>
        )}
      />

      {error ? (
        <EmptyLibrary icon={<Cloud size={40} />} title="无法读取收藏夹" subtitle={error} />
      ) : tracks.length === 0 ? (
        <EmptyLibrary icon={<Cloud size={40} />} title={loading ? '正在加载' : '收藏夹为空'} subtitle={loading ? '正在从 B站读取收藏夹内容。' : '这个 B站收藏夹里没有可播放的视频。'} />
      ) : (
        <MusicSection title="收藏内容" icon={<Music size={22} />}>
          <TrackList>
            {tracks.map((track, index) => (
              <TrackListRow
                key={track.id}
                track={track}
                index={index + 1}
                isCurrent={player.currentTrack?.id === track.id}
                isPlaying={player.isPlaying}
                onPlay={() => player.playNow(track)}
                extra={(
                  <div className="am-extra-actions">
                    <TrackActions track={track} size={15} />
                  </div>
                )}
              />
            ))}
          </TrackList>
          {hasMore && (
            <div className="favorite-load-more">
              <button type="button" className="am-action am-action--subtle" onClick={() => void loadMoreTracks('manual')} disabled={loadingMore}>
                {loadingMore ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {loadingMore ? '正在加载' : '加载更多'}
              </button>
            </div>
          )}
          <div ref={sentinelRef} className="favorite-load-sentinel" aria-hidden="true" />
          {moreError && <div className="favorite-load-error">{moreError}</div>}
        </MusicSection>
      )}
    </MusicPageShell>
  )
}

function mergeUniqueTracks(current: Track[], incoming: Track[]): Track[] {
  const seen = new Set(current.map((track) => track.bvid || track.id))
  const next = incoming.filter((track) => {
    const key = track.bvid || track.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...current, ...next]
}
