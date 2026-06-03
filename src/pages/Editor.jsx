import { useEffect, useRef, useState } from 'react'
import { formatTimecode, formatClock, DEFAULT_FPS } from '../utils/time.js'
import {
  ArrowLeftIcon,
  PlayIcon,
  PauseIcon,
} from '../components/Icons.jsx'

const FPS = DEFAULT_FPS
const FRAME = 1 / FPS
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2]

const CTRL_BTN =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-2.5 text-[12px] text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'
const ICON_BTN =
  'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border border-[#444] bg-transparent text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'

// Local files can't be loaded via file:// from the http dev origin, so route
// them through the media:// scheme registered in electron/main.js.
function toMediaUrl(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`
}

const clampPct = (p) => Math.min(100, Math.max(0, p))

export default function Editor({ project, onBack }) {
  const [videoSrc, setVideoSrc] = useState('')
  const [episodeName, setEpisodeName] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [inPoint, setInPoint] = useState(null)
  const [outPoint, setOutPoint] = useState(null)
  const [volume, setVolume] = useState(1)
  const [playbackRate, setPlaybackRate] = useState(1)

  const videoRef = useRef(null)
  const trackRef = useRef(null)

  // --- video actions (read live values off the element to stay closure-safe) ---

  function togglePlay() {
    const v = videoRef.current
    if (!v || !v.currentSrc) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  function seek(t) {
    const v = videoRef.current
    if (!v || Number.isNaN(v.duration)) return
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
    setEpisodeName(base.replace(/\.[^.]+$/, ''))
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

  function handleLoadedMetadata() {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration)
    v.volume = volume
    v.playbackRate = playbackRate
  }

  // --- scrubber seeking (click + drag) ---

  function seekToClientX(clientX) {
    const el = trackRef.current
    const v = videoRef.current
    if (!el || !v || !v.duration) return
    const rect = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    seek(frac * v.duration)
  }

  function handleTrackMouseDown(e) {
    if (!videoSrc) return
    seekToClientX(e.clientX)
    const move = (ev) => seekToClientX(ev.clientX)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // --- smooth playhead while playing ---
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const loop = () => {
      const v = videoRef.current
      if (v) setCurrentTime(v.currentTime)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  // --- keyboard shortcuts (window-level, mount/unmount) ---
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
  const showRegion =
    hasDuration && inPoint != null && outPoint != null && outPoint > inPoint
  const regionStyle = showRegion
    ? {
        left: `${clampPct((inPoint / duration) * 100)}%`,
        width: `${clampPct(((outPoint - inPoint) / duration) * 100)}%`,
      }
    : null

  return (
    <div className="flex h-screen w-full select-none flex-col overflow-hidden bg-bg text-white">
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
        <div className="w-8 shrink-0" />
      </div>

      {/* Middle: video (left) + clips placeholder (right) */}
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

        {/* Right panel — reserved for clips (Phase 4) */}
        <div className="flex w-80 shrink-0 items-center justify-center border-l border-border bg-surface">
          <p className="text-[13px] text-[#666]">Clips will appear here</p>
        </div>
      </div>

      {/* Bottom bar — timeline scrubber */}
      <div className="h-20 shrink-0 border-t border-border bg-surface px-4 py-3">
        <div
          ref={trackRef}
          onMouseDown={handleTrackMouseDown}
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
    </div>
  )
}
