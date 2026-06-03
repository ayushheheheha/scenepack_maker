import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../utils/time.js'

const PRIMARY_FULL =
  'inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-white text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_FULL =
  'inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent text-[13px] text-white transition-colors hover:bg-[#1a1a1a]'
const SECONDARY_SM =
  'inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md border border-[#444] bg-transparent px-2 text-[12px] text-white transition-colors hover:bg-[#1a1a1a]'

export default function ExportPanel({
  dramaName,
  clips,
  subfolders,
  defaultOutputDir,
  onClose,
  onExported,
}) {
  const [outputDir, setOutputDir] = useState(defaultOutputDir || '')
  const [phase, setPhase] = useState('config') // config | running | done
  const [progress, setProgress] = useState({ done: 0, total: 0, currentFile: '' })
  const [result, setResult] = useState(null)
  const [fatalError, setFatalError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)

  const assigned = clips.filter((c) => Array.isArray(c.folders) && c.folders.length > 0)
  const noFolder = clips.filter((c) => !Array.isArray(c.folders) || c.folders.length === 0)
  const countFor = (sub) =>
    clips.filter((c) => Array.isArray(c.folders) && c.folders.includes(sub)).length
  const usedSubfolders = subfolders.filter((s) => countFor(s) > 0)

  // Subscribe to main-process progress events.
  useEffect(() => {
    const unsub = window.electronAPI.onExportProgress((p) => setProgress(p))
    return unsub
  }, [])

  // Tick elapsed time while running.
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 250)
    return () => clearInterval(id)
  }, [phase])

  async function changeFolder() {
    const dir = await window.electronAPI.openFolder()
    if (dir) setOutputDir(dir)
  }

  async function startExport() {
    if (!outputDir || assigned.length === 0) return
    setFatalError('')
    setResult(null)
    setProgress({ done: 0, total: 0, currentFile: '' })
    startRef.current = Date.now()
    setElapsed(0)
    setPhase('running')
    try {
      const res = await window.electronAPI.startExport({
        clips,
        subfolders,
        outputDir,
        dramaName,
      })
      setResult(res)
      setElapsed((Date.now() - startRef.current) / 1000)
      setPhase('done')
      if (res?.exportedIds?.length && typeof onExported === 'function') {
        onExported(res.exportedIds)
      }
    } catch (e) {
      setFatalError(e?.message || String(e))
      setPhase('done')
    }
  }

  function openOutputFolder() {
    if (outputDir) window.electronAPI.openPath(outputDir)
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const errorCount = result?.errors?.length || 0

  return (
    <aside className="absolute bottom-20 right-0 top-12 z-20 flex w-80 flex-col border-l border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="text-[14px] font-medium">Export scenepack</h2>
        <button
          onClick={(e) => {
            e.currentTarget.blur()
            onClose()
          }}
          aria-label="Close export panel"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded text-[#888] transition-colors hover:bg-[#1a1a1a] hover:text-white"
        >
          ✕
        </button>
      </div>

      {phase === 'config' && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="text-[11px] uppercase tracking-wide text-[#666]">Output folder</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">
                {outputDir || 'Not set'}
              </span>
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  changeFolder()
                }}
                className={SECONDARY_SM}
              >
                Change
              </button>
            </div>

            <p className="mt-4 text-[12px] text-[#888]">
              {assigned.length} clip{assigned.length === 1 ? '' : 's'} across{' '}
              {usedSubfolders.length} subfolder{usedSubfolders.length === 1 ? '' : 's'}
            </p>

            <div className="mt-3 space-y-0.5">
              {subfolders.length === 0 ? (
                <p className="text-[12px] text-[#666]">No subfolders defined.</p>
              ) : (
                subfolders.map((s) => (
                  <div
                    key={s}
                    className="flex items-center justify-between rounded px-2 py-1 text-[12px]"
                  >
                    <span className="min-w-0 truncate">{s}</span>
                    <span className="shrink-0 text-[#666]">×{countFor(s)} clips</span>
                  </div>
                ))
              )}
            </div>

            {noFolder.length > 0 && (
              <p className="mt-3 text-[12px] text-amber-400">
                {noFolder.length} clip{noFolder.length === 1 ? '' : 's'} have no subfolder —
                they will be skipped
              </p>
            )}
          </div>

          <div className="border-t border-border p-3">
            <button
              onClick={(e) => {
                e.currentTarget.blur()
                startExport()
              }}
              disabled={!outputDir || assigned.length === 0}
              className={PRIMARY_FULL}
            >
              Start Export
            </button>
          </div>
        </>
      )}

      {phase === 'running' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="text-[12px] text-white/80">Exporting…</p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-[#222]">
            <div className="h-full bg-white" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12px] tabular-nums text-[#888]">
            {progress.done} / {progress.total}
          </p>
          <p className="mt-1 truncate text-[12px] text-[#666]">{progress.currentFile || '…'}</p>
          <p className="mt-1 text-[12px] tabular-nums text-[#666]">
            Elapsed {formatClock(elapsed)}
          </p>
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {fatalError ? (
              <p className="text-[13px] text-red-400">{fatalError}</p>
            ) : result?.success ? (
              <p className="text-[14px] font-medium text-white">Export complete</p>
            ) : (
              <>
                <p className="text-[14px] font-medium text-white">
                  Export finished with {errorCount} issue{errorCount === 1 ? '' : 's'}
                </p>
                <div className="mt-2 space-y-1">
                  {result?.errors?.map((e, i) => (
                    <p key={i} className="text-[12px] text-red-400">
                      {e}
                    </p>
                  ))}
                </div>
              </>
            )}
            {!fatalError && result && (
              <p className="mt-3 text-[12px] tabular-nums text-[#666]">
                {result.done} / {result.total} files · {formatClock(elapsed)}
              </p>
            )}
          </div>

          <div className="flex gap-2 border-t border-border p-3">
            {(fatalError || !result?.success) && (
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  startExport()
                }}
                className={SECONDARY_FULL}
              >
                Retry
              </button>
            )}
            {!fatalError && (
              <button
                onClick={(e) => {
                  e.currentTarget.blur()
                  openOutputFolder()
                }}
                className={PRIMARY_FULL}
              >
                Open folder
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
