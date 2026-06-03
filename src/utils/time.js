// Time formatting helpers for the editor.

export const DEFAULT_FPS = 24

/**
 * Format seconds as HH:MM:SS:FF (frames at the given fps).
 * @param {number} seconds
 * @param {number} [fps]
 */
export function formatTimecode(seconds, fps = DEFAULT_FPS) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const totalFrames = Math.floor(seconds * fps)
  const frames = totalFrames % fps
  const totalSeconds = Math.floor(seconds)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(frames)}`
}

/**
 * Compact clock label for timeline ticks: M:SS, or H:MM:SS past an hour.
 * @param {number} seconds
 */
export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const ss = total % 60
  const mm = Math.floor(total / 60) % 60
  const hh = Math.floor(total / 3600)
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`
}
