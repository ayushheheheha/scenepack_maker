// Extract a single video frame as a JPEG data URL using the bundled ffmpeg.
// Done in the main process so it works for any codec and avoids canvas
// cross-origin tainting in the renderer.
const { execFile } = require('node:child_process')

let ffmpegPath = require('ffmpeg-static')
if (ffmpegPath && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
}

/**
 * @param {string} filePath absolute path to the video
 * @param {number} time seconds
 * @param {number} [width] thumbnail width in px (height keeps aspect)
 * @returns {Promise<string|null>} data:image/jpeg;base64,... or null on failure
 */
function extractFrame(filePath, time, width = 160) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !filePath) return resolve(null)
    const args = [
      '-loglevel', 'error',
      '-ss', String(Math.max(0, time || 0)),
      '-i', filePath,
      '-an',
      '-frames:v', '1',
      '-vf', `scale=${width}:-2`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1',
    ]
    execFile(
      ffmpegPath,
      args,
      { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 15000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout || stdout.length === 0) return resolve(null)
        resolve(`data:image/jpeg;base64,${stdout.toString('base64')}`)
      }
    )
  })
}

module.exports = { extractFrame }
