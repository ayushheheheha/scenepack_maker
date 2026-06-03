// Helpers for reading/writing project.json through the Electron IPC bridge.
// All disk access happens in the main process; this module only shapes data
// and delegates to window.electronAPI. See electron/preload.js for the surface.

/**
 * Create a fresh, schema-valid project object.
 * @param {string} drama - drama name
 * @param {string[]} [subfolders] - initial subfolder names
 */
export function createProject(drama, subfolders = []) {
  return {
    drama,
    createdAt: new Date().toISOString(),
    subfolders,
    clips: [],
  }
}

/**
 * Create a schema-valid clip object with sensible defaults.
 * @param {object} clip
 * @param {string} clip.id - unique id, e.g. "clip_001"
 * @param {string} [clip.episode]
 * @param {string} [clip.sourcePath] - absolute path to source video
 * @param {number} [clip.in] - in point in seconds
 * @param {number} [clip.out] - out point in seconds
 * @param {string[]} [clip.folders] - subfolders this clip belongs to
 * @param {string} [clip.label] - optional note
 */
export function createClip({
  id,
  episode = '',
  sourcePath = '',
  in: inPoint = 0,
  out = 0,
  folders = [],
  label = '',
}) {
  return { id, episode, sourcePath, in: inPoint, out, folders, label }
}

/** Generate the next sequential clip id like "clip_001" from existing clips. */
export function nextClipId(clips = []) {
  const max = clips.reduce((acc, c) => {
    const n = Number.parseInt(String(c.id ?? '').replace(/\D/g, ''), 10)
    return Number.isNaN(n) ? acc : Math.max(acc, n)
  }, 0)
  return `clip_${String(max + 1).padStart(3, '0')}`
}

/** Minimal shape validation for a loaded project. */
export function isValidProject(p) {
  return (
    !!p &&
    typeof p.drama === 'string' &&
    Array.isArray(p.subfolders) &&
    Array.isArray(p.clips)
  )
}

/** Read and parse project.json from a folder. Resolves to the project object. */
export async function readProject(folderPath) {
  return window.electronAPI.readProject(folderPath)
}

/** Write a project object to project.json in a folder. Resolves to the file path. */
export async function writeProject(folderPath, project) {
  return window.electronAPI.writeProject(folderPath, project)
}
