// media:// protocol — streams local files into the renderer with proper HTTP
// range support so the <video> element can seek. file:// is blocked when the
// renderer is served over http:// (dev), hence a custom scheme. URL shape:
//   media://local/<url-encoded absolute file path>
const { protocol } = require('electron')
const path = require('node:path')
const { stat } = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { Readable } = require('node:stream')

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
}

// Must run before app 'ready'.
function registerMediaSchemePrivileged() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
}

// Resolve a media:// request to a (possibly partial) file Response.
// Pure enough to unit-test with a plain Request — uses no Electron APIs.
async function handleMediaRequest(request) {
  const encodedPath = new URL(request.url).pathname.replace(/^\//, '')
  const filePath = decodeURIComponent(encodedPath)

  let info
  try {
    info = await stat(filePath)
  } catch {
    return new Response('Not found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  const total = info.size
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  const rangeHeader = request.headers.get('range')

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    let start = match && match[1] !== '' ? parseInt(match[1], 10) : 0
    let end = match && match[2] !== '' ? parseInt(match[2], 10) : total - 1
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= total) end = total - 1
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${total}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }
    const chunkSize = end - start + 1
    const body = Readable.toWeb(createReadStream(filePath, { start, end }))
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        // CORS so the renderer can read frames into a canvas (thumbnails)
        // without tainting it. The video element must set crossOrigin too.
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  const body = Readable.toWeb(createReadStream(filePath))
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// Must run after app 'ready'.
function registerMediaProtocol() {
  protocol.handle('media', handleMediaRequest)
}

module.exports = {
  registerMediaSchemePrivileged,
  registerMediaProtocol,
  handleMediaRequest,
}
