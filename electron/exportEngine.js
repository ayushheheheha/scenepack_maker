// Export engine — cuts clips into per-subfolder folders with ffmpeg.
// Uses only fluent-ffmpeg / ffmpeg-static / fs, so it is unit-testable in plain
// Node (no Electron APIs at call time).
const path = require('node:path')
const { mkdir, stat } = require('node:fs/promises')
const ffmpeg = require('fluent-ffmpeg')
const ffmpegStatic = require('ffmpeg-static')

// Point fluent-ffmpeg at the bundled binary. When packaged, the binary is
// unpacked from the asar (see electron-builder.config.js).
let ffmpegPath = ffmpegStatic
if (ffmpegPath && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
}
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)

// Characters illegal in path segments on Windows/macOS/Linux. Spaces and
// hyphens are valid and intentionally preserved (e.g. "Ri Jeong-hyeok").
const ILLEGAL_SEGMENT_CHARS = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']

function sanitizeSegment(name, fallback) {
  let cleaned = String(name ?? '')
  for (const ch of ILLEGAL_SEGMENT_CHARS) cleaned = cleaned.split(ch).join('_')
  cleaned = cleaned.trim()
  return cleaned || fallback
}

async function fileExists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

// Run one cut. reencode=false uses stream copy (fast); true re-encodes.
function runFfmpeg(src, inT, outT, outputPath, reencode) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(src)
      .inputOptions([`-ss ${inT}`])
      .outputOptions([`-t ${outT - inT}`])
    if (reencode) cmd.outputOptions(['-c:v libx264', '-c:a aac'])
    else cmd.outputOptions(['-c copy'])
    cmd
      .outputOptions(['-y'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}

/**
 * @param {{clips:any[], subfolders:string[], outputDir:string, dramaName:string}} payload
 * @param {(p:{done:number,total:number,currentFile:string})=>void} [onProgress]
 * @returns {Promise<{success:boolean, errors:string[], exportedIds:string[], done:number, total:number}>}
 */
async function runExport(payload, onProgress) {
  const { clips = [], subfolders = [], outputDir, dramaName } = payload
  const errors = []
  const exportedIds = new Set()
  const tasks = []

  if (!outputDir) {
    return { success: false, errors: ['No output folder selected'], exportedIds: [], done: 0, total: 0 }
  }

  const dramaSeg = sanitizeSegment(dramaName, 'drama')

  // Build the task list (so we know the total before processing). Numbering
  // resets per episode within each subfolder.
  for (const sub of subfolders) {
    const folderDir = path.join(outputDir, dramaSeg, sanitizeSegment(sub, 'subfolder'))
    await mkdir(folderDir, { recursive: true })

    const inFolder = clips
      .filter((c) => Array.isArray(c.folders) && c.folders.includes(sub))
      .sort((a, b) => {
        const e = String(a.episode || '').localeCompare(String(b.episode || ''), undefined, {
          numeric: true,
        })
        return e !== 0 ? e : a.in - b.in
      })

    const counters = {}
    for (const clip of inFolder) {
      if (!(clip.out > clip.in)) {
        errors.push(`${clip.episode || 'clip'} (${sub}): in >= out — skipped`)
        continue
      }
      if (!clip.sourcePath || !(await fileExists(clip.sourcePath))) {
        errors.push(`${clip.episode || 'clip'} (${sub}): source file not found — skipped`)
        continue
      }
      const ep = sanitizeSegment(clip.episode, 'clip')
      counters[ep] = (counters[ep] || 0) + 1
      const filename = `${ep}_${String(counters[ep]).padStart(3, '0')}.mp4`
      tasks.push({ clip, outputPath: path.join(folderDir, filename), filename })
    }
  }

  const total = tasks.length
  let done = 0
  onProgress?.({ done, total, currentFile: '' })

  for (const task of tasks) {
    onProgress?.({ done, total, currentFile: task.filename })
    try {
      try {
        await runFfmpeg(task.clip.sourcePath, task.clip.in, task.clip.out, task.outputPath, false)
      } catch {
        // Stream copy failed (codec/container mismatch) — re-encode.
        await runFfmpeg(task.clip.sourcePath, task.clip.in, task.clip.out, task.outputPath, true)
      }
      exportedIds.add(task.clip.id)
    } catch (err) {
      errors.push(`${task.filename}: ${err?.message || String(err)}`)
    }
    done += 1
    onProgress?.({ done, total, currentFile: task.filename })
  }

  return { success: errors.length === 0, errors, exportedIds: [...exportedIds], done, total }
}

module.exports = { runExport, sanitizeSegment }
