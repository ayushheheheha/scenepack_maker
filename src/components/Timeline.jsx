import { useCallback, useEffect, useRef, useState } from 'react'
import { formatClock } from '../utils/time.js'

const MAX_PX_PER_SEC = 400
const FILMSTRIP_MAX = 60
const TICK_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

const ZOOM_BTN =
  'grid h-6 w-6 cursor-pointer place-items-center rounded border border-[#444] bg-[#111]/90 text-[15px] leading-none text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'

// Generate an evenly-spaced set of frame thumbnails for the filmstrip. Frames
// are sampled once per video (independent of zoom) and tiled across the bar.
function useFilmstrip(src, duration) {
  const [urls, setUrls] = useState([])
  useEffect(() => {
    setUrls([])
    if (!src || !(duration > 0)) return
    const count = Math.min(FILMSTRIP_MAX, Math.max(8, Math.round(duration / 1.5)))
    const times = Array.from({ length: count }, (_, i) =>
      Math.min(Math.max(duration - 0.05, 0), ((i + 0.5) * duration) / count)
    )
    setUrls(new Array(count).fill(null))

    let cancelled = false
    let i = 0
    let ready = false
    let settled = false
    let watchdog = null
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous' // pair with CORS headers so canvas isn't tainted
    video.muted = true
    video.preload = 'auto'
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 90
    const ctx = canvas.getContext('2d')

    const cleanup = () => {
      clearTimeout(watchdog)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        /* ignore */
      }
    }
    const settle = (url) => {
      if (cancelled || settled) return
      settled = true
      clearTimeout(watchdog)
      const idx = i
      setUrls((prev) => {
        if (idx >= prev.length) return prev
        const copy = prev.slice()
        copy[idx] = url
        return copy
      })
      i += 1
      seekNext()
    }
    const seekNext = () => {
      if (cancelled || i >= count) return cleanup()
      settled = false
      clearTimeout(watchdog)
      watchdog = setTimeout(() => settle(null), 4000)
      try {
        video.currentTime = times[i]
      } catch {
        settle(null)
      }
    }
    const onSeeked = () => {
      let url = null
      try {
        ctx.drawImage(video, 0, 0, 160, 90)
        url = canvas.toDataURL('image/jpeg', 0.5)
      } catch {
        url = null
      }
      settle(url)
    }
    const onLoaded = () => {
      if (!ready) {
        ready = true
        seekNext()
      }
    }
    const onError = () => settle(null)

    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.src = src

    return () => {
      cancelled = true
      cleanup()
    }
  }, [src, duration])
  return urls
}

export default function Timeline({
  duration,
  currentTime,
  isPlaying,
  inPoint,
  outPoint,
  clips,
  episodePath,
  videoSrc,
  onScrub,
}) {
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const durationRef = useRef(duration)
  durationRef.current = duration

  const [viewportW, setViewportW] = useState(0)
  const [pxPerSec, setPxPerSec] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const lastFitDurRef = useRef(-1)

  const frames = useFilmstrip(videoSrc, duration)

  // Measure the viewport width.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setViewportW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit-to-window whenever a new duration (new video) arrives.
  useEffect(() => {
    if (duration > 0 && viewportW > 0 && lastFitDurRef.current !== duration) {
      lastFitDurRef.current = duration
      setPxPerSec(viewportW / duration)
      if (viewportRef.current) viewportRef.current.scrollLeft = 0
      setScrollLeft(0)
    }
  }, [duration, viewportW])

  const doZoom = useCallback((factor) => {
    const el = viewportRef.current
    const dur = durationRef.current
    if (!el || !(dur > 0)) return
    const minPx = el.clientWidth / dur
    setPxPerSec((prev) => {
      const base = prev || minPx
      const next = Math.min(MAX_PX_PER_SEC, Math.max(minPx, base * factor))
      const centerTime = (el.scrollLeft + el.clientWidth / 2) / base
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, centerTime * next - el.clientWidth / 2)
        setScrollLeft(el.scrollLeft)
      })
      return next
    })
  }, [])

  // ctrl/⌘ + wheel zooms; plain wheel scrolls the timeline horizontally.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        doZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)
      } else if (e.deltaY !== 0 && el.scrollWidth > el.clientWidth) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
        setScrollLeft(el.scrollLeft)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [doZoom])

  const fitPx = duration > 0 && viewportW > 0 ? viewportW / duration : 0
  const effPx = pxPerSec || fitPx
  const hasVideo = !!videoSrc && duration > 0 && effPx > 0
  const contentWidth = hasVideo ? duration * effPx : viewportW || 0
  const count = frames.length
  const cellPxW = count > 0 && contentWidth > 0 ? contentWidth / count : 0
  const clampPx = (px) => Math.max(0, Math.min(contentWidth, px))

  // Keep the playhead on screen during playback.
  useEffect(() => {
    if (!isPlaying || !hasVideo) return
    const el = viewportRef.current
    if (!el) return
    const px = currentTime * effPx
    const margin = 48
    if (px < el.scrollLeft + margin || px > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = Math.max(0, px - el.clientWidth * 0.3)
    }
  }, [currentTime, isPlaying, hasVideo, effPx])

  // Adaptive tick interval (labels ~55px apart), windowed to the visible range.
  let tickInterval = TICK_INTERVALS[TICK_INTERVALS.length - 1]
  for (const iv of TICK_INTERVALS) {
    if (iv * effPx >= 55) {
      tickInterval = iv
      break
    }
  }
  const ticks = []
  if (hasVideo) {
    const viewEndT = Math.min(duration, (scrollLeft + viewportW) / effPx)
    const startT = Math.max(tickInterval, Math.floor(scrollLeft / effPx / tickInterval) * tickInterval)
    for (let t = startT; t <= viewEndT; t += tickInterval) ticks.push(t)
  }

  const currentClips = hasVideo
    ? clips.filter((c) => c.sourcePath && c.sourcePath === episodePath)
    : []
  const showRegion = hasVideo && inPoint != null && outPoint != null && outPoint > inPoint

  function handleMouseDown(e) {
    if (!hasVideo) return
    const content = contentRef.current
    if (!content) return
    const at = (clientX) => {
      const rect = content.getBoundingClientRect()
      const t = Math.min(duration, Math.max(0, (clientX - rect.left) / effPx))
      onScrub(t)
    }
    at(e.clientX)
    const move = (ev) => at(ev.clientX)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="relative h-24 shrink-0 border-t border-border bg-surface">
      {/* Zoom controls */}
      <div className="absolute right-2 top-1 z-30 flex items-center gap-1">
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            doZoom(1 / 1.5)
          }}
          disabled={!hasVideo}
          aria-label="Zoom out"
          className={ZOOM_BTN}
        >
          −
        </button>
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            doZoom(1.5)
          }}
          disabled={!hasVideo}
          aria-label="Zoom in"
          className={ZOOM_BTN}
        >
          +
        </button>
      </div>

      <div
        ref={viewportRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        className="timeline-scroll h-full w-full overflow-x-auto overflow-y-hidden"
      >
        <div
          ref={contentRef}
          onMouseDown={handleMouseDown}
          className={`relative h-full ${hasVideo ? 'cursor-pointer' : 'cursor-default'}`}
          style={{ width: contentWidth || '100%' }}
        >
          {/* Filmstrip frames */}
          {frames.map((url, i) => (
            <div
              key={i}
              className="absolute inset-y-0 border-r border-black/40 bg-[#0a0a0a] bg-cover bg-center"
              style={{
                left: i * cellPxW,
                width: cellPxW,
                backgroundImage: url ? `url(${url})` : undefined,
              }}
            />
          ))}

          {/* Time ticks (adaptive + windowed) */}
          {ticks.map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute inset-y-0"
              style={{ left: clampPx(t * effPx) }}
            >
              <div className="absolute bottom-0 h-2.5 w-px bg-white/25" />
              <div className="absolute bottom-2.5 -translate-x-1/2 rounded-sm bg-black/55 px-0.5 text-[9px] leading-tight text-white/70">
                {formatClock(t)}
              </div>
            </div>
          ))}

          {/* Clip boundary ticks (saved clips on this video) */}
          {currentClips.flatMap((c) => [
            <div
              key={`${c.id}-in`}
              className="pointer-events-none absolute top-0 h-2.5 w-px bg-amber-400"
              style={{ left: clampPx(c.in * effPx) }}
            />,
            <div
              key={`${c.id}-out`}
              className="pointer-events-none absolute top-0 h-2.5 w-px bg-amber-400"
              style={{ left: clampPx(c.out * effPx) }}
            />,
          ])}

          {/* In/out region */}
          {showRegion && (
            <div
              className="pointer-events-none absolute inset-y-0 bg-white/10"
              style={{ left: clampPx(inPoint * effPx), width: Math.max(0, (outPoint - inPoint) * effPx) }}
            />
          )}

          {/* In marker */}
          {inPoint != null && hasVideo && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-green-500"
              style={{ left: clampPx(inPoint * effPx) }}
            >
              <span className="absolute left-1 top-0.5 rounded-sm bg-black/55 px-0.5 text-[9px] font-medium text-green-400">
                IN
              </span>
            </div>
          )}

          {/* Out marker */}
          {outPoint != null && hasVideo && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-red-500"
              style={{ left: clampPx(outPoint * effPx) }}
            >
              <span className="absolute right-1 top-0.5 rounded-sm bg-black/55 px-0.5 text-[9px] font-medium text-red-400">
                OUT
              </span>
            </div>
          )}

          {/* Playhead */}
          {hasVideo && (
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white"
              style={{ left: clampPx(currentTime * effPx) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
