import { useEffect, useState } from 'react'
import { formatMMSS } from '../utils/time.js'
import { PlayIcon, TrashIcon } from './Icons.jsx'

const THUMB_W = 80
const THUMB_H = 45

// Extract the frame at `inTime` via ffmpeg in the main process (robust for any
// codec; no canvas tainting). Shows a dark placeholder until ready / on failure.
function ClipThumbnail({ sourcePath, inTime }) {
  const [dataUrl, setDataUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    if (!sourcePath) return
    window.electronAPI
      .extractThumbnail(sourcePath, inTime, THUMB_W)
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sourcePath, inTime])

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
  exported = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}) {
  const [label, setLabel] = useState(clip.label || '')
  const [adding, setAdding] = useState(false)
  const [newSub, setNewSub] = useState('')

  const duration = Math.max(0, clip.out - clip.in)

  function commitNewSub() {
    onAddSubfolder(clip.id, newSub)
    setNewSub('')
    setAdding(false)
  }

  return (
    <div
      className={`group relative rounded-md border bg-bg p-2 ${
        selected ? 'border-white/40' : 'border-border'
      }`}
    >
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
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(clip.id)}
            aria-label="Select clip for re-export"
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer self-start accent-white"
          />
        )}
        <ClipThumbnail sourcePath={clip.sourcePath} inTime={clip.in} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-medium tabular-nums">
            {formatMMSS(duration)}
            {exported && (
              <span className="rounded bg-green-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-green-400">
                Exported
              </span>
            )}
          </p>
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
