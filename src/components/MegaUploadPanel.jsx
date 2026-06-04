import { useEffect, useState } from 'react'

const GB = 1024 * 1024 * 1024
const fmtSize = (b) => {
  if (typeof b !== 'number') return '—'
  if (b >= GB) return `${(b / GB).toFixed(2)} GB`
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} B`
}
const fmtFree = (a) =>
  typeof a.spaceUsed === 'number' && typeof a.spaceTotal === 'number'
    ? ` — ${fmtSize(a.spaceTotal - a.spaceUsed)} free`
    : ''

const PRIMARY =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-4 text-[13px] text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-50'
const SMALL =
  'inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md border border-[#444] bg-transparent px-2.5 text-[12px] text-white transition-colors hover:bg-[#1a1a1a]'

export default function MegaUploadPanel({ project, onClose, onManifestUpdate }) {
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [sourceDir, setSourceDir] = useState(project?.exportDir || '')
  const [code, setCode] = useState('')
  const [scan, setScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [phase, setPhase] = useState('config') // config | uploading | done
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const manifest = (project?.uploads && project.uploads[accountId]) || {}

  useEffect(() => {
    window.electronAPI.mega
      .list()
      .then((a) => {
        setAccounts(a)
        if (a.length) setAccountId((id) => id || a[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.mega.onUploadProgress((p) => setProgress(p))
    return unsub
  }, [])

  // Re-scan whenever the account, folder, or stored manifest changes.
  useEffect(() => {
    if (!sourceDir || !accountId) {
      setScan(null)
      return
    }
    let cancelled = false
    setScanning(true)
    window.electronAPI.mega
      .scanUploads({ sourceDir, manifest })
      .then((s) => !cancelled && setScan(s))
      .catch(() => !cancelled && setScan(null))
      .finally(() => !cancelled && setScanning(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDir, accountId, project?.uploads])

  async function chooseFolder() {
    const dir = await window.electronAPI.openFolder()
    if (dir) setSourceDir(dir)
  }

  async function doUpload() {
    if (!accountId || !sourceDir) return
    setError('')
    setResult(null)
    setProgress(null)
    setPhase('uploading')
    try {
      const res = await window.electronAPI.mega.uploadDrama({
        accountId,
        sourceDir,
        manifest,
        secondFactorCode: code,
      })
      setResult(res)
      setPhase('done')
      if (res?.manifest && typeof onManifestUpdate === 'function') {
        onManifestUpdate(accountId, res.manifest)
      }
    } catch (e) {
      setError(e?.message || String(e))
      setPhase('config')
    }
  }

  const pct = progress
    ? progress.totalBytes
      ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100))
      : progress.total
        ? Math.round((progress.done / progress.total) * 100)
        : 0
    : 0

  return (
    <div
      onMouseDown={phase === 'uploading' ? undefined : onClose}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[84vh] w-[560px] flex-col rounded-lg border border-border bg-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[15px] font-medium">Upload to MEGA</h2>
            <p className="mt-0.5 text-[11px] text-[#666]">
              Only new or changed files are uploaded — like a push.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded text-[#888] transition-colors hover:bg-[#1a1a1a] hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {phase === 'config' && (
            <>
              {accounts.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[#666]">
                  No MEGA accounts yet. Add one from the “MEGA” button first.
                </p>
              ) : (
                <>
                  {/* Account */}
                  <label className="text-[11px] uppercase tracking-wide text-[#666]">
                    Account
                  </label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="mt-1 h-9 w-full cursor-pointer rounded-md border border-border bg-bg px-2 text-[13px] text-white outline-none focus:border-[#444]"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-[#111]">
                        {(a.label || a.email) + fmtFree(a)}
                      </option>
                    ))}
                  </select>

                  {/* Source folder */}
                  <label className="mt-4 block text-[11px] uppercase tracking-wide text-[#666]">
                    Folder to upload
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">
                      {sourceDir || 'Not set — export your clips first, or choose a folder'}
                    </span>
                    <button onClick={chooseFolder} className={SMALL}>
                      Change
                    </button>
                  </div>

                  {/* Scan summary */}
                  <div className="mt-4 rounded-md border border-border bg-bg p-3 text-[12px]">
                    {!sourceDir ? (
                      <span className="text-[#666]">Pick a folder to see what will upload.</span>
                    ) : scanning ? (
                      <span className="text-[#666]">Scanning…</span>
                    ) : scan ? (
                      <div className="space-y-0.5">
                        <p>
                          <span className="font-medium text-white">{scan.toUpload}</span>{' '}
                          <span className="text-[#888]">
                            new/changed file{scan.toUpload === 1 ? '' : 's'} to upload
                          </span>{' '}
                          <span className="text-[#666]">({fmtSize(scan.bytesToUpload)})</span>
                        </p>
                        <p className="text-[#666]">
                          {scan.upToDate} already uploaded · {scan.total} total in folder
                        </p>
                      </div>
                    ) : (
                      <span className="text-[#666]">Couldn’t read that folder.</span>
                    )}
                  </div>

                  {/* Optional 2FA */}
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="2FA code (only if this account needs it)"
                    className="mt-3 h-9 w-full rounded-md border border-border bg-bg px-3 text-[13px] text-white outline-none placeholder:text-[#555] focus:border-[#444]"
                  />

                  {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}
                </>
              )}
            </>
          )}

          {phase === 'uploading' && (
            <div>
              <p className="text-[12px] text-white/80">Uploading…</p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-[#222]">
                <div className="h-full bg-white" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-[12px] tabular-nums text-[#888]">
                {progress ? `${progress.done} / ${progress.total} files` : 'Starting…'}
                {progress && progress.totalBytes
                  ? ` · ${fmtSize(progress.uploadedBytes)} of ${fmtSize(progress.totalBytes)}`
                  : ''}
              </p>
              <p className="mt-1 truncate text-[12px] text-[#666]">
                {progress?.currentFile || '…'}
              </p>
            </div>
          )}

          {phase === 'done' && result && (
            <div>
              <p className="text-[14px] font-medium text-white">
                {result.uploaded > 0
                  ? `Uploaded ${result.uploaded} file${result.uploaded === 1 ? '' : 's'}`
                  : 'Already up to date'}
              </p>
              <p className="mt-1 text-[12px] text-[#666]">
                {result.skipped} unchanged
                {result.remoteSkipped
                  ? ` · ${result.remoteSkipped} already on MEGA`
                  : ''}
                {result.failed?.length ? ` · ${result.failed.length} failed` : ''}
              </p>

              {result.failed?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {result.failed.map((f, i) => (
                    <p key={i} className="text-[12px] text-red-400">
                      {f.file}: {f.error}
                    </p>
                  ))}
                </div>
              )}

              {result.link && (
                <div className="mt-4">
                  <label className="text-[11px] uppercase tracking-wide text-[#666]">
                    Share link
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-2 py-1.5 text-[12px] text-white/80">
                      {result.link}
                    </span>
                    <button
                      onClick={() => navigator.clipboard?.writeText(result.link)}
                      className={SMALL}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border p-3">
          {phase === 'config' && (
            <button
              onClick={doUpload}
              disabled={!accountId || !sourceDir || !scan || scan.toUpload === 0}
              className={PRIMARY}
            >
              {scan && scan.toUpload === 0 ? 'Up to date' : 'Start upload'}
            </button>
          )}
          {phase === 'done' && (
            <button onClick={() => setPhase('config')} className={SECONDARY}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
