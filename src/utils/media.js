// Build a media:// URL (served by electron/mediaProtocol.js) from an absolute
// local file path. file:// is blocked from the http dev origin, so all local
// video is routed through this custom scheme. The path is a single URL-encoded
// segment: media://local/<encoded absolute path>.
export function toMediaUrl(filePath) {
  if (!filePath) return ''
  return `media://local/${encodeURIComponent(filePath)}`
}
