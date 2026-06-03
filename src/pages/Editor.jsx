import { useEffect, useRef, useState } from 'react'
import { formatTimecode, formatClock, DEFAULT_FPS } from '../utils/time.js'
import { toMediaUrl } from '../utils/media.js'
import { ArrowLeftIcon, PlayIcon, PauseIcon } from '../components/Icons.jsx'
import ClipCard from '../components/ClipCard.jsx'
import ExportPanel from '../components/ExportPanel.jsx'

const FPS = DEFAULT_FPS
const FRAME = 1 / FPS
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2]

const CTRL_BTN =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-2.5 text-[12px] text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'
const ICON_BTN =
  'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border border-[#444] bg-transparent text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'

const clampPct = (p) => Math.min(100, Math.max(0, p))

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

  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const playUntilRef = useRef(null) // stop playback at this time (clip preview)
  const pendingPlayRef = useRef(null) // {in,out} to play once a new src loads

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
    persist(next, subfolders)
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

  // --- timeline geometry ---
  const hasDuration = duration > 0 && Number.isFinite(duration)
  const ticks = []
  if (hasDuration) {
    for (let t = 10; t < duration; t += 10) ticks.push(t)
  }
  // Clip boundary ticks — only for clips belonging to the loaded video.
  const clipTicks = []
  if (hasDuration) {
    for (const c of clips) {
      if (!c.sourcePath || c.sourcePath !== episodePath) continue
      clipTicks.push({ key: `${c.id}-in`, pct: clampPct((c.in / duration) * 100) })
      clipTicks.push({ key: `${c.id}-out`, pct: clampPct((c.out / duration) * 100) })
    }
  }
  const showRegion =
    hasDuration && inPoint != null && outPoint != null && outPoint > inPoint
  const regionStyle = showRegion
    ? {
        left: `${clampPct((inPoint / duration) * 100)}%`,
        width: `${clampPct(((outPoint - inPoint) / duration) * 100)}%`,
      }
    : null

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
        <div className="flex-1 truncate text-center text-[13px]">
          <span className="text-white/80">{project?.drama ?? 'Untitled'}</span>
          {episodeName && <span className="text-[#666]"> · {episodeName}</span>}
        </div>
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            setShowExport(true)
          }}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-white px-3 text-[12px] font-medium text-black transition-colors hover:bg-white/90"
        >
          Export
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

        {/* Right panel — clip workspace */}
        <div className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
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
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {clips.length === 0 ? (
              <p className="mt-6 text-center text-[12px] text-[#666]">No clips yet</p>
            ) : (
              clips.map((clip) => (
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
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar — timeline scrubber */}
      <div className="h-20 shrink-0 border-t border-border bg-surface px-4 py-3">
        <div
          ref={trackRef}
          onMouseDown={(e) => {
            if (!videoSrc) return
            const el = trackRef.current
            const v = videoRef.current
            if (!el || !v || !v.duration) return
            const rect = el.getBoundingClientRect()
            const at = (clientX) => {
              const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
              seek(frac * v.duration)
            }
            at(e.clientX)
            const move = (ev) => at(ev.clientX)
            const up = () => {
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          }}
          className={`relative h-full w-full overflow-hidden rounded-sm bg-[#161616] ${
            videoSrc ? 'cursor-pointer' : 'cursor-default'
          }`}
        >
          {/* In/out region */}
          {regionStyle && (
            <div className="pointer-events-none absolute inset-y-0 bg-white/10" style={regionStyle} />
          )}

          {/* Ticks every 10s */}
          {ticks.map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute inset-y-0"
              style={{ left: `${(t / duration) * 100}%` }}
            >
              <div className="absolute bottom-3.5 h-2 w-px bg-[#333]" />
              <div className="absolute bottom-0.5 -translate-x-1/2 text-[9px] leading-none text-[#555]">
                {formatClock(t)}
              </div>
            </div>
          ))}

          {/* Clip boundary ticks (saved clips on this video) */}
          {clipTicks.map(({ key, pct }) => (
            <div
              key={key}
              className="pointer-events-none absolute top-0 h-2.5 w-px bg-amber-400"
              style={{ left: `${pct}%` }}
            />
          ))}

          {/* In marker */}
          {inPoint != null && hasDuration && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-green-500"
              style={{ left: `${clampPct((inPoint / duration) * 100)}%` }}
            >
              <span className="absolute left-1 top-0.5 text-[9px] font-medium text-green-500">
                IN
              </span>
            </div>
          )}

          {/* Out marker */}
          {outPoint != null && hasDuration && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500"
              style={{ left: `${clampPct((outPoint / duration) * 100)}%` }}
            >
              <span className="absolute right-1 top-0.5 text-[9px] font-medium text-red-500">
                OUT
              </span>
            </div>
          )}

          {/* Playhead */}
          {hasDuration && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
              style={{ left: `${clampPct((currentTime / duration) * 100)}%` }}
            />
          )}
        </div>
      </div>

      {showExport && (
        <ExportPanel
          dramaName={project?.drama ?? 'Untitled'}
          clips={clips}
          subfolders={subfolders}
          defaultOutputDir={projectPath}
          onClose={() => setShowExport(false)}
          onExported={markExported}
        />
      )}
    </div>
  )
}
