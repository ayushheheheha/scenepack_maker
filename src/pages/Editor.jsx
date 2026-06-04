import { useEffect, useRef, useState } from 'react'
import { formatTimecode, DEFAULT_FPS } from '../utils/time.js'
import { toMediaUrl } from '../utils/media.js'
import { ArrowLeftIcon, PlayIcon, PauseIcon, ChevronRightIcon } from '../components/Icons.jsx'
import ClipCard from '../components/ClipCard.jsx'
import ExportPanel from '../components/ExportPanel.jsx'
import Timeline from '../components/Timeline.jsx'

const FPS = DEFAULT_FPS
const FRAME = 1 / FPS
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2]

const CTRL_BTN =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-2.5 text-[12px] text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'
const ICON_BTN =
  'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border border-[#444] bg-transparent text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'

export default function Editor({ project, projectPath, setProject, onBack }) {
  // Video player state (Phase 3)
  const [videoSrc, setVideoSrc] = useState('')
  const [episodePath, setEpisodePath] = useState('') // absolute file path of loaded video
  const [episodeName, setEpisodeName] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [inPoint, setInPoint] = useState(null)
  const [outPoint, setOutPoint] = useState(null)
  const [volume, setVolume] = useState(1)
  const [playbackRate, setPlaybackRate] = useState(1)

  // Clip workspace state (Phase 4) — seeded from the loaded project (load-on-open)
  const [clips, setClips] = useState(() => project?.clips ?? [])
  const [subfolders, setSubfolders] = useState(() => project?.subfolders ?? [])
  const [clipError, setClipError] = useState('')
  const [showExport, setShowExport] = useState(false)
  const [exportTargets, setExportTargets] = useState([]) // clips the open Export panel will cut
  const [selectedIds, setSelectedIds] = useState(() => new Set()) // selected exported clips
  const [clipTab, setClipTab] = useState('pending') // 'pending' | 'exported'
  const [expandedEpisodes, setExpandedEpisodes] = useState(() => new Set()) // open episode groups

  // Resizable clip panel width (persisted).
  const MIN_PANEL = 280
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('scp.clipPanelWidth'))
      return saved >= MIN_PANEL ? saved : 360
    } catch {
      return 360
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('scp.clipPanelWidth', String(panelWidth))
    } catch {
      /* ignore */
    }
  }, [panelWidth])

  function startResize(e) {
    e.preventDefault()
    const onMove = (ev) => {
      const maxW = window.innerWidth - 420 // keep room for the video side
      const w = window.innerWidth - ev.clientX
      setPanelWidth(Math.max(MIN_PANEL, Math.min(maxW, w)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const videoRef = useRef(null)
  const playUntilRef = useRef(null) // stop playback at this time (clip preview)
  const pendingPlayRef = useRef(null) // {in,out} to play once a new src loads
  const pendingSeekRef = useRef(null) // latest scrub target (coalesces in-flight seeks)

  // --- persistence: write project.json and sync lifted state ---
  function persist(nextClips, nextSubfolders) {
    const base = project ?? {
      drama: 'Untitled',
      createdAt: new Date().toISOString(),
      subfolders: [],
      clips: [],
    }
    const updated = { ...base, subfolders: nextSubfolders, clips: nextClips }
    if (typeof setProject === 'function') setProject(updated)
    if (projectPath) {
      window.electronAPI
        .writeProject(projectPath, updated)
        .catch((e) => console.error('Failed to save project.json', e))
    }
  }

  // --- video actions (read live values off the element to stay closure-safe) ---

  function togglePlay() {
    const v = videoRef.current
    if (!v || !v.currentSrc) return
    playUntilRef.current = null // manual control cancels clip-preview auto-stop
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  function seek(t) {
    const v = videoRef.current
    if (!v || Number.isNaN(v.duration)) return
    playUntilRef.current = null
    const clamped = Math.min(v.duration, Math.max(0, t))
    v.currentTime = clamped
    setCurrentTime(clamped)
  }

  // Live scrubbing from the timeline: move the playhead immediately and seek
  // to the latest target as fast as the decoder allows (coalesce in-flight
  // seeks so the preview updates live while dragging, not only on release).
  function scrubTo(time) {
    const v = videoRef.current
    if (!v || Number.isNaN(v.duration)) return
    playUntilRef.current = null
    const t = Math.min(v.duration, Math.max(0, time))
    setCurrentTime(t)
    pendingSeekRef.current = t
    if (!v.seeking) v.currentTime = t
  }

  function handleSeeked() {
    const v = videoRef.current
    if (!v) return
    const target = pendingSeekRef.current
    if (target == null) return
    if (Math.abs(target - v.currentTime) > 0.04) {
      if (!v.seeking) v.currentTime = target
    } else {
      pendingSeekRef.current = null
    }
  }

  function stepFrames(n) {
    const v = videoRef.current
    if (v) seek(v.currentTime + n * FRAME)
  }

  function stepSeconds(s) {
    const v = videoRef.current
    if (v) seek(v.currentTime + s)
  }

  function markIn() {
    const v = videoRef.current
    if (!v || Number.isNaN(v.duration)) return
    setInPoint(v.currentTime)
  }

  function markOut() {
    const v = videoRef.current
    if (!v || Number.isNaN(v.duration)) return
    setOutPoint(v.currentTime)
  }

  function clearMarkers() {
    setInPoint(null)
    setOutPoint(null)
  }

  async function loadEpisode() {
    const filePath = await window.electronAPI.openFile({
      filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi'] }],
    })
    if (!filePath) return
    const base = filePath.split(/[\\/]/).pop() || ''
    playUntilRef.current = null
    pendingPlayRef.current = null
    setEpisodeName(base.replace(/\.[^.]+$/, ''))
    setEpisodePath(filePath)
    setInPoint(null)
    setOutPoint(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setVideoSrc(toMediaUrl(filePath))
  }

  function handleVolume(e) {
    const val = Number(e.target.value)
    setVolume(val)
    if (videoRef.current) videoRef.current.volume = val
  }

  function handleRate(e) {
    const val = Number(e.target.value)
    setPlaybackRate(val)
    if (videoRef.current) videoRef.current.playbackRate = val
  }

  function startRangePlayback(inT, outT) {
    const v = videoRef.current
    if (!v) return
    playUntilRef.current = outT
    const t = Math.max(0, Math.min(inT, v.duration || inT))
    v.currentTime = t
    setCurrentTime(t)
    v.play().catch(() => {})
  }

  function handleLoadedMetadata() {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration)
    v.volume = volume
    v.playbackRate = playbackRate
    if (pendingPlayRef.current) {
      const { in: inT, out: outT } = pendingPlayRef.current
      pendingPlayRef.current = null
      startRangePlayback(inT, outT)
    }
  }

  // --- clip actions (Phase 4) ---

  function addClip() {
    if (inPoint == null || outPoint == null) {
      setClipError('Set in and out points first')
      return
    }
    setClipError('')
    const lo = Math.min(inPoint, outPoint)
    const hi = Math.max(inPoint, outPoint)
    const clip = {
      id: `clip_${Date.now()}`,
      episode: episodeName,
      sourcePath: episodePath, // absolute file path (schema: "absolute path")
      in: lo,
      out: hi,
      folders: [],
      label: '',
    }
    const next = [...clips, clip]
    setClips(next)
    setInPoint(null)
    setOutPoint(null)
    persist(next, subfolders)
  }

  function deleteClip(id) {
    const next = clips.filter((c) => c.id !== id)
    setClips(next)
    persist(next, subfolders)
  }

  function toggleClipFolder(clipId, folderName) {
    const next = clips.map((c) => {
      if (c.id !== clipId) return c
      const has = c.folders.includes(folderName)
      return {
        ...c,
        folders: has
          ? c.folders.filter((f) => f !== folderName)
          : [...c.folders, folderName],
      }
    })
    setClips(next)
    persist(next, subfolders)
  }

  function setClipLabel(clipId, label) {
    const next = clips.map((c) => (c.id === clipId ? { ...c, label } : c))
    setClips(next)
    persist(next, subfolders)
  }

  function addSubfolderForClip(clipId, rawName) {
    const name = rawName.trim()
    if (!name) return
    const nextSubs = subfolders.includes(name) ? subfolders : [...subfolders, name]
    const nextClips = clips.map((c) => {
      if (c.id !== clipId) return c
      return c.folders.includes(name) ? c : { ...c, folders: [...c.folders, name] }
    })
    setSubfolders(nextSubs)
    setClips(nextClips)
    persist(nextClips, nextSubs)
  }

  // Mark exported clips and persist (called after a successful export).
  function markExported(exportedIds) {
    if (!Array.isArray(exportedIds) || exportedIds.length === 0) return
    const set = new Set(exportedIds)
    const next = clips.map((c) => (set.has(c.id) ? { ...c, exported: true } : c))
    setClips(next)
    setSelectedIds(new Set())
    setClipTab('exported') // surface the results
    persist(next, subfolders)
  }

  // Open the Export panel for a specific set of clips.
  function openExport(targets) {
    if (!targets || targets.length === 0) return
    setExportTargets(targets)
    setShowExport(true)
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleEpisode(ep) {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev)
      if (next.has(ep)) next.delete(ep)
      else next.add(ep)
      return next
    })
  }

  function playClip(clip) {
    // If the clip belongs to a different source than what's loaded, load it
    // first and play the range once metadata is ready.
    if (clip.sourcePath && clip.sourcePath !== episodePath) {
      pendingPlayRef.current = { in: clip.in, out: clip.out }
      setEpisodeName(clip.episode || '')
      setEpisodePath(clip.sourcePath)
      setCurrentTime(0)
      setDuration(0)
      setVideoSrc(toMediaUrl(clip.sourcePath))
      return
    }
    startRangePlayback(clip.in, clip.out)
  }

  // Rename the current episode. Also relabels existing clips cut from this
  // source so their exported filenames use the new prefix.
  function commitEpisodeName() {
    const name = episodeName.trim()
    if (name !== episodeName) setEpisodeName(name)
    if (!episodePath) return
    let changed = false
    const next = clips.map((c) => {
      if (c.sourcePath === episodePath && c.episode !== name) {
        changed = true
        return { ...c, episode: name }
      }
      return c
    })
    if (changed) {
      setClips(next)
      persist(next, subfolders)
    }
  }

  // --- smooth playhead + clip-preview auto-stop ---
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const loop = () => {
      const v = videoRef.current
      if (v) {
        setCurrentTime(v.currentTime)
        if (playUntilRef.current != null && v.currentTime >= playUntilRef.current) {
          v.pause()
          playUntilRef.current = null
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  // --- keyboard shortcuts (window-level) ---
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'i':
        case 'I':
          e.preventDefault()
          markIn()
          break
        case 'o':
        case 'O':
          e.preventDefault()
          markOut()
          break
        case 'ArrowLeft':
          e.preventDefault()
          stepFrames(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          stepFrames(1)
          break
        case 'j':
        case 'J':
          e.preventDefault()
          stepSeconds(-5)
          break
        case 'l':
        case 'L':
          e.preventDefault()
          stepSeconds(5)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clip sections: pending (not yet exported) vs already exported.
  const pendingClips = clips.filter((c) => !c.exported)
  const exportedClips = clips.filter((c) => c.exported)
  const selectedCount = exportedClips.filter((c) => selectedIds.has(c.id)).length
  const allExportedSelected = exportedClips.length > 0 && selectedCount === exportedClips.length
  function toggleSelectAll() {
    setSelectedIds(
      allExportedSelected ? new Set() : new Set(exportedClips.map((c) => c.id))
    )
  }

  // Group exported clips by episode (for the collapsible dropdowns).
  const exportedGroups = (() => {
    const map = new Map()
    for (const c of exportedClips) {
      const ep = c.episode || 'episode'
      if (!map.has(ep)) map.set(ep, [])
      map.get(ep).push(c)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([episode, items]) => ({ episode, items }))
  })()

  return (
    <div className="relative flex h-screen w-full select-none flex-col overflow-hidden bg-bg text-white">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <button
          onClick={onBack}
          aria-label="Back to Home"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-white/70 transition-colors hover:bg-[#1a1a1a] hover:text-white"
        >
          <ArrowLeftIcon size={18} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[13px]">
          <span className="max-w-[40%] truncate text-white/80">
            {project?.drama ?? 'Untitled'}
          </span>
          {episodePath && (
            <>
              <span className="text-[#666]">·</span>
              <input
                value={episodeName}
                onChange={(e) => setEpisodeName(e.target.value)}
                onBlur={commitEpisodeName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                placeholder="episode name"
                title="Episode name — used as the export filename prefix (e.g. episode 1_001.mp4)"
                className="w-52 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] text-[#aaa] outline-none transition-colors placeholder:text-[#555] hover:border-[#333] focus:border-[#444] focus:text-white"
              />
            </>
          )}
        </div>
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            openExport(pendingClips)
          }}
          disabled={pendingClips.length === 0}
          title={
            pendingClips.length === 0
              ? 'No new clips to export'
              : `Export ${pendingClips.length} new clip(s)`
          }
          className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-white px-3 text-[12px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export{pendingClips.length > 0 ? ` (${pendingClips.length})` : ''}
        </button>
      </div>

      {/* Middle: video (left) + clip workspace (right) */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Video area */}
          <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
            {videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                controls={false}
                className="max-h-full max-w-full object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onSeeked={handleSeeked}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
              />
            ) : (
              <button
                onClick={loadEpisode}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90"
              >
                Load Episode
              </button>
            )}
          </div>

          {/* Control bar */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
            <button
              onClick={(e) => {
                e.currentTarget.blur()
                loadEpisode()
              }}
              className={CTRL_BTN}
            >
              Load Episode
            </button>

            <button
              onClick={(e) => {
                e.currentTarget.blur()
                togglePlay()
              }}
              disabled={!videoSrc}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className={ICON_BTN}
            >
              {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </button>

            <span className="ml-1 text-[12px] tabular-nums">
              {formatTimecode(currentTime)}
              <span className="text-[#666]"> / {formatTimecode(duration)}</span>
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  markIn()
                }}
                disabled={!videoSrc}
                className={CTRL_BTN}
              >
                Set In
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  markOut()
                }}
                disabled={!videoSrc}
                className={CTRL_BTN}
              >
                Set Out
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  clearMarkers()
                }}
                disabled={!videoSrc || (inPoint == null && outPoint == null)}
                className={CTRL_BTN}
              >
                Clear
              </button>

              <div className="flex items-center gap-1.5 pl-1">
                <span className="text-[11px] text-[#666]">Vol</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={handleVolume}
                  disabled={!videoSrc}
                  aria-label="Volume"
                  className="h-1 w-20 cursor-pointer accent-white disabled:cursor-not-allowed"
                />
              </div>

              <select
                value={playbackRate}
                onChange={handleRate}
                disabled={!videoSrc}
                aria-label="Playback speed"
                className="h-8 cursor-pointer rounded-md border border-[#444] bg-transparent px-1.5 text-[12px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s} className="bg-[#111] text-white">
                    {s}x
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Drag handle — resize video vs. clip panel */}
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-[#555]"
        />

        {/* Right panel — clip workspace (resizable) */}
        <div
          className="flex shrink-0 flex-col border-l border-border bg-surface"
          style={{ width: panelWidth }}
        >
          <div className="border-b border-border p-3">
            <button
              onClick={(e) => {
                e.currentTarget.blur()
                addClip()
              }}
              className="inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-white text-[13px] font-medium text-black transition-colors hover:bg-white/90"
            >
              Add Clip
            </button>
            {clipError && (
              <p className="mt-2 text-center text-[12px] text-red-400">{clipError}</p>
            )}

            {/* Pending / Exported tabs */}
            <div className="mt-3 flex gap-1">
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  setClipTab('pending')
                }}
                className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  clipTab === 'pending'
                    ? 'bg-white text-black'
                    : 'border border-[#333] text-[#888] hover:bg-[#1a1a1a] hover:text-white'
                }`}
              >
                Pending ({pendingClips.length})
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  setClipTab('exported')
                }}
                className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  clipTab === 'exported'
                    ? 'bg-white text-black'
                    : 'border border-[#333] text-[#888] hover:bg-[#1a1a1a] hover:text-white'
                }`}
              >
                Exported ({exportedClips.length})
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {clipTab === 'pending' ? (
              pendingClips.length === 0 ? (
                <p className="mt-6 text-center text-[12px] text-[#666]">
                  No clips to export. Set in/out points, then click Add Clip.
                </p>
              ) : (
                pendingClips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    subfolders={subfolders}
                    onPlay={playClip}
                    onDelete={deleteClip}
                    onToggleFolder={toggleClipFolder}
                    onLabelChange={setClipLabel}
                    onAddSubfolder={addSubfolderForClip}
                  />
                ))
              )
            ) : exportedClips.length === 0 ? (
              <p className="mt-6 text-center text-[12px] text-[#666]">No exported clips yet.</p>
            ) : (
              <>
                {/* Selection toolbar */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-[#666]">
                    {selectedCount > 0 ? `${selectedCount} selected` : `${exportedClips.length} clips`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur()
                        toggleSelectAll()
                      }}
                      className="cursor-pointer rounded border border-[#444] px-2 py-0.5 text-[11px] text-white transition-colors hover:bg-[#1a1a1a]"
                    >
                      {allExportedSelected ? 'Clear' : 'Select all'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur()
                        openExport(exportedClips.filter((c) => selectedIds.has(c.id)))
                      }}
                      disabled={selectedCount === 0}
                      className="cursor-pointer rounded bg-white px-2 py-0.5 text-[11px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Re-export{selectedCount > 0 ? ` (${selectedCount})` : ''}
                    </button>
                  </div>
                </div>

                {/* Collapsible episode groups */}
                {exportedGroups.map(({ episode, items }) => {
                  const open = expandedEpisodes.has(episode)
                  return (
                    <div key={episode} className="overflow-hidden rounded-md border border-border">
                      <button
                        onClick={(e) => {
                          e.currentTarget.blur()
                          toggleEpisode(episode)
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#1a1a1a]"
                      >
                        <ChevronRightIcon
                          size={14}
                          className={`shrink-0 text-[#888] ${open ? 'rotate-90' : ''}`}
                        />
                        <span className="truncate text-[12px] font-medium">{episode}</span>
                        <span className="text-[11px] text-[#666]">({items.length})</span>
                      </button>
                      {open && (
                        <div className="space-y-3 border-t border-border p-2">
                          {items.map((clip) => (
                            <ClipCard
                              key={clip.id}
                              clip={clip}
                              subfolders={subfolders}
                              onPlay={playClip}
                              onDelete={deleteClip}
                              onToggleFolder={toggleClipFolder}
                              onLabelChange={setClipLabel}
                              onAddSubfolder={addSubfolderForClip}
                              exported
                              selectable
                              selected={selectedIds.has(clip.id)}
                              onToggleSelect={toggleSelect}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar — timeline scrubber (filmstrip + zoom) */}
      <Timeline
        duration={duration}
        currentTime={currentTime}
        isPlaying={isPlaying}
        inPoint={inPoint}
        outPoint={outPoint}
        clips={clips}
        episodePath={episodePath}
        onScrub={scrubTo}
      />

      {showExport && (
        <ExportPanel
          dramaName={project?.drama ?? 'Untitled'}
          clips={exportTargets}
          allClips={clips}
          subfolders={subfolders}
          defaultOutputDir={projectPath}
          width={panelWidth}
          onClose={() => setShowExport(false)}
          onExported={markExported}
        />
      )}
    </div>
  )
}
