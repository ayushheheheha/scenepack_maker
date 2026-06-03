import { useEffect, useState } from 'react'
import { formatMMSS } from '../utils/time.js'
import { toMediaUrl } from '../utils/media.js'
import { PlayIcon, TrashIcon } from './Icons.jsx'

const THUMB_W = 80
const THUMB_H = 45

// Extracts a single frame at `inTime` from the video at `src` and draws it to a
// canvas. Runs once per (src, inTime); on any failure shows a dark placeholder.
function ClipThumbnail({ src, inTime }) {
  const [dataUrl, setDataUrl] = useState(null)

  useEffect(() => {
    if (!src) return
    let done = false
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous' // pair with CORS headers so canvas isn't tainted
    video.muted = true
    video.preload = 'auto'

    const timer = setTimeout(() => finish(null), 6000)

    function cleanup() {
      clearTimeout(timer)
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

    function finish(url) {
      if (done) return
      done = true
      cleanup()
      if (url) setDataUrl(url)
    }

    function draw() {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = THUMB_W
        canvas.height = THUMB_H
        canvas.getContext('2d').drawImage(video, 0, 0, THUMB_W, THUMB_H)
        finish(canvas.toDataURL('image/jpeg', 0.6))
      } catch {
        finish(null) // tainted canvas / decode error → placeholder
      }
    }

    function onLoaded() {
      const dur = video.duration || inTime || 0
      const t = Math.max(0, Math.min(inTime || 0, Math.max(0, dur - 0.05)))
      if (Math.abs(video.currentTime - t) < 0.05) draw()
      else {
        try {
          video.currentTime = t
        } catch {
          finish(null)
        }
      }
    }
    const onSeeked = () => draw()
    const onError = () => finish(null)

    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.src = src

    return () => {
      done = true
      cleanup()
    }
  }, [src, inTime])

  return dataUrl ? (
    <img
      src={dataUrl}
      alt=""
      width={THUMB_W}
      height={THUMB_H}
      className="shrink-0 rounded-sm object-cover"
      style={{ width: THUMB_W, height: THUMB_H }}
    />
  ) : (
    <div
      className="shrink-0 rounded-sm bg-[#0a0a0a]"
      style={{ width: THUMB_W, height: THUMB_H }}
    />
  )
}

const CHIP_SELECTED =
  'cursor-pointer rounded bg-white px-2 py-0.5 text-[11px] font-medium text-black transition-colors'
const CHIP_UNSELECTED =
  'cursor-pointer rounded border border-[#444] bg-transparent px-2 py-0.5 text-[11px] text-[#888] transition-colors hover:bg-[#1a1a1a]'
const ACTION_BTN =
  'grid h-6 w-6 cursor-pointer place-items-center rounded border border-[#444] bg-[#111] text-white transition-colors hover:bg-[#1a1a1a]'

export default function ClipCard({
  clip,
  subfolders,
  onPlay,
  onDelete,
  onToggleFolder,
  onLabelChange,
  onAddSubfolder,
}) {
  const [label, setLabel] = useState(clip.label || '')
  const [adding, setAdding] = useState(false)
  const [newSub, setNewSub] = useState('')

  const duration = Math.max(0, clip.out - clip.in)
  const thumbSrc = toMediaUrl(clip.sourcePath)

  function commitNewSub() {
    onAddSubfolder(clip.id, newSub)
    setNewSub('')
    setAdding(false)
  }

  return (
    <div className="group relative rounded-md border border-border bg-bg p-2">
      {/* Actions (hover) */}
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            onPlay(clip)
          }}
          aria-label="Play clip"
          className={ACTION_BTN}
        >
          <PlayIcon size={12} />
        </button>
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            onDelete(clip.id)
          }}
          aria-label="Delete clip"
          className={ACTION_BTN}
        >
          <TrashIcon size={12} />
        </button>
      </div>

      {/* Thumbnail + info */}
      <div className="flex gap-2">
        <ClipThumbnail src={thumbSrc} inTime={clip.in} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium tabular-nums">{formatMMSS(duration)}</p>
          <p className="mt-0.5 truncate text-[11px] text-[#666] tabular-nums">
            {clip.episode || 'episode'} &nbsp;{formatMMSS(clip.in)} → {formatMMSS(clip.out)}
          </p>
        </div>
      </div>

      {/* Label */}
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== (clip.label || '')) onLabelChange(clip.id, label)
        }}
        placeholder="Add label..."
        className="mt-2 h-7 w-full rounded border border-border bg-surface px-2 text-[12px] text-white outline-none transition-colors placeholder:text-[#555] focus:border-[#444]"
      />

      {/* Subfolder chips */}
      <div className="mt-2 flex flex-wrap gap-1">
        {subfolders.map((name) => {
          const selected = clip.folders.includes(name)
          return (
            <button
              key={name}
              onClick={(e) => {
                e.currentTarget.blur()
                onToggleFolder(clip.id, name)
              }}
              className={selected ? CHIP_SELECTED : CHIP_UNSELECTED}
            >
              {name}
            </button>
          )
        })}

        {adding ? (
          <input
            autoFocus
            value={newSub}
            onChange={(e) => setNewSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNewSub()
              if (e.key === 'Escape') {
                setNewSub('')
                setAdding(false)
              }
            }}
            onBlur={() => {
              setNewSub('')
              setAdding(false)
            }}
            placeholder="name"
            className="h-6 w-24 rounded border border-border bg-surface px-1.5 text-[11px] text-white outline-none placeholder:text-[#555] focus:border-[#444]"
          />
        ) : (
          <button
            onClick={(e) => {
              e.currentTarget.blur()
              setAdding(true)
            }}
            className="cursor-pointer rounded border border-dashed border-[#444] px-1.5 py-0.5 text-[11px] text-[#888] transition-colors hover:bg-[#1a1a1a]"
          >
            + Add subfolder
          </button>
        )}
      </div>
    </div>
  )
}
