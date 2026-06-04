// Incremental MEGA uploader (main process).
//
// Works like a one-way "git push" for a drama's exported folder: it walks the
// local folder, diffs it against a per-account manifest (relpath -> size+mtime),
// and uploads ONLY new or changed files, mirroring the folder structure on MEGA.
// The manifest is stored in project.json by the renderer.
const path = require('node:path')
const { readdir, stat } = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { loginStorage } = require('./megaAccounts')

// Recursively list files under `root` with POSIX relpaths + size + mtime.
async function walkFiles(root) {
  const out = []
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.isFile()) {
        const st = await stat(abs)
        out.push({
          relpath: path.relative(root, abs).split(path.sep).join('/'),
          absPath: abs,
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
        })
      }
    }
  }
  await walk(root)
  return out
}

// A file needs uploading if it's not in the manifest, or its size/mtime changed.
function isChanged(file, manEntry) {
  if (!manEntry) return true
  return manEntry.size !== file.size || manEntry.mtime !== file.mtime
}

// Dry-run: what would upload vs. what's already up to date.
async function scanUploads({ sourceDir, manifest }) {
  const files = await walkFiles(sourceDir)
  const manFiles = (manifest && manifest.files) || {}
  let toUpload = 0
  let upToDate = 0
  let bytesToUpload = 0
  const items = files.map((f) => {
    const changed = isChanged(f, manFiles[f.relpath])
    if (changed) {
      toUpload++
      bytesToUpload += f.size
    } else {
      upToDate++
    }
    return {
      relpath: f.relpath,
      size: f.size,
      status: !manFiles[f.relpath] ? 'new' : changed ? 'changed' : 'uploaded',
    }
  })
  return { total: files.length, toUpload, upToDate, bytesToUpload, items }
}

async function ensureChild(parent, name) {
  const existing = (parent.children || []).find((c) => c.directory && c.name === name)
  if (existing) return existing
  return parent.mkdir({ name })
}

// Resolve (creating if needed) the MEGA folder node for a relative dir, cached.
async function ensureDir(dramaFolder, dir, cache) {
  if (cache.has(dir)) return cache.get(dir)
  let node = dramaFolder
  let acc = ''
  for (const part of dir ? dir.split('/') : []) {
    acc = acc ? `${acc}/${part}` : part
    if (cache.has(acc)) {
      node = cache.get(acc)
      continue
    }
    node = await ensureChild(node, part)
    cache.set(acc, node)
  }
  return node
}

function uploadOne(folderNode, file, onBytes) {
  return new Promise((resolve, reject) => {
    const name = file.relpath.split('/').pop()
    let up
    try {
      up = folderNode.upload({ name, size: file.size })
    } catch (e) {
      return reject(e)
    }
    up.on('progress', (p) => {
      if (p && typeof p.bytesLoaded === 'number') onBytes(p.bytesLoaded)
    })
    up.on('error', reject)
    up.complete.then(resolve, reject)
    createReadStream(file.absPath).on('error', reject).pipe(up)
  })
}

/**
 * Upload only new/changed files from `sourceDir` to `accountId`, mirroring the
 * folder structure. The MEGA root folder is named after sourceDir's basename.
 * @returns {Promise<{success, uploaded, skipped, failed, total, manifest, link}>}
 */
async function uploadDrama({ accountId, sourceDir, manifest = {}, secondFactorCode }, onProgress) {
  const files = await walkFiles(sourceDir)
  const manFiles = { ...((manifest && manifest.files) || {}) }
  const toUpload = files.filter((f) => isChanged(f, manFiles[f.relpath]))
  const total = toUpload.length
  const skipped = files.length - total
  const dramaName = path.basename(sourceDir)

  if (total === 0) {
    return {
      success: true,
      uploaded: 0,
      skipped,
      failed: [],
      total: 0,
      manifest: { ...manifest, files: manFiles },
      link: manifest?.link || null,
    }
  }

  const totalBytes = toUpload.reduce((s, f) => s + f.size, 0)
  let uploadedBytes = 0
  let done = 0
  let remoteSkipped = 0
  const failed = []
  let link = manifest?.link || null

  const { storage } = await loginStorage(accountId, secondFactorCode)
  try {
    const dramaFolder = await ensureChild(storage.root, dramaName)
    const cache = new Map([['', dramaFolder]])

    for (const f of toUpload) {
      const dir = f.relpath.includes('/') ? f.relpath.slice(0, f.relpath.lastIndexOf('/')) : ''
      const fileName = f.relpath.split('/').pop()
      onProgress?.({ done, total, currentFile: f.relpath, fileLoaded: 0, fileSize: f.size, uploadedBytes, totalBytes })
      try {
        const folderNode = await ensureDir(dramaFolder, dir, cache)
        // MEGA allows duplicate names in a folder, so explicitly skip a file
        // that already exists at this exact location (e.g. uploaded manually).
        const existing = (folderNode.children || []).find(
          (c) => !c.directory && c.name === fileName
        )
        if (existing) {
          remoteSkipped++
          manFiles[f.relpath] = {
            size: f.size,
            mtime: f.mtime,
            nodeId: existing.nodeId || null,
            uploadedAt: new Date().toISOString(),
          }
        } else {
          const node = await uploadOne(folderNode, f, (loaded) => {
            onProgress?.({ done, total, currentFile: f.relpath, fileLoaded: loaded, fileSize: f.size, uploadedBytes: uploadedBytes + loaded, totalBytes })
          })
          manFiles[f.relpath] = {
            size: f.size,
            mtime: f.mtime,
            nodeId: node?.nodeId || null,
            uploadedAt: new Date().toISOString(),
          }
        }
      } catch (e) {
        failed.push({ file: f.relpath, error: e?.message || String(e) })
      }
      done++
      uploadedBytes += f.size
      onProgress?.({ done, total, currentFile: f.relpath, fileLoaded: f.size, fileSize: f.size, uploadedBytes, totalBytes })
    }

    try {
      link = await dramaFolder.shareFolder({})
    } catch {
      /* link generation is best-effort */
    }
  } finally {
    try {
      storage.close()
    } catch {
      /* ignore */
    }
  }

  const updatedManifest = { ...manifest, files: manFiles, link, updatedAt: new Date().toISOString() }
  return {
    success: failed.length === 0,
    uploaded: total - failed.length - remoteSkipped,
    skipped, // unchanged per local manifest
    remoteSkipped, // already present on MEGA at that location
    failed,
    total,
    manifest: updatedManifest,
    link,
  }
}

module.exports = { scanUploads, uploadDrama, walkFiles, isChanged }
