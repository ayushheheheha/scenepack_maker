import { useState } from 'react'
import {
  createProject,
  readProject,
  writeProject,
  isValidProject,
} from '../utils/projectIO.js'
import { PlusIcon, TrashIcon, FolderIcon } from '../components/Icons.jsx'
import MegaDashboard from '../components/MegaDashboard.jsx'
import MegaUploadPanel from '../components/MegaUploadPanel.jsx'

// Shared button styles. transition-colors is the only allowed transition.
const PRIMARY_BTN =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY_BTN =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-4 text-[13px] text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-50'

export default function Home({
  project,
  projectPath,
  setProject,
  setProjectPath,
  onOpenEditor,
}) {
  const [showMega, setShowMega] = useState(false)

  // STATE 1 vs STATE 2 is derived purely from whether a project is loaded.
  return (
    <div className="relative h-full w-full">
      {project ? (
        <DramaManager
          project={project}
          projectPath={projectPath}
          setProject={setProject}
          onOpenEditor={onOpenEditor}
        />
      ) : (
        <Landing setProject={setProject} setProjectPath={setProjectPath} />
      )}

      <button
        onClick={() => setShowMega(true)}
        className="absolute right-4 top-4 z-30 inline-flex h-8 cursor-pointer items-center rounded-md border border-[#444] bg-bg/80 px-3 text-[12px] text-white transition-colors hover:bg-[#1a1a1a]"
      >
        MEGA
      </button>

      {showMega && <MegaDashboard onClose={() => setShowMega(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// STATE 1 — no project open
// ---------------------------------------------------------------------------

function Landing({ setProject, setProjectPath }) {
  const [pendingFolder, setPendingFolder] = useState(null) // folder chosen for a new drama
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleNewDrama() {
    setError('')
    setBusy(true)
    try {
      const folder = await window.electronAPI.openFolder()
      if (!folder) return
      setPendingFolder(folder)
      // Pre-fill the name with the folder's basename as a convenience.
      setName(folder.split(/[\\/]/).filter(Boolean).pop() || '')
    } finally {
      setBusy(false)
    }
  }

  async function confirmNewDrama() {
    const drama = name.trim()
    if (!drama || !pendingFolder) return
    setBusy(true)
    setError('')
    try {
      const created = createProject(drama, [])
      await writeProject(pendingFolder, created)
      setProjectPath(pendingFolder)
      setProject(created)
    } catch (e) {
      setError(`Could not create project: ${e?.message ?? e}`)
    } finally {
      setBusy(false)
    }
  }

  function cancelNewDrama() {
    setPendingFolder(null)
    setName('')
  }

  async function handleOpenDrama() {
    setError('')
    setBusy(true)
    try {
      const folder = await window.electronAPI.openFolder()
      if (!folder) return
      const loaded = await readProject(folder)
      if (!isValidProject(loaded)) {
        setError('That folder does not contain a valid project.json.')
        return
      }
      setProjectPath(folder)
      setProject(loaded)
    } catch {
      setError('No project.json found in that folder.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-bg text-white">
      <h1 className="text-4xl font-medium tracking-tight">ScenePack Maker</h1>

      <div className="mt-8 flex gap-3">
        <button onClick={handleNewDrama} disabled={busy} className={PRIMARY_BTN}>
          New Drama
        </button>
        <button onClick={handleOpenDrama} disabled={busy} className={SECONDARY_BTN}>
          Open Drama
        </button>
      </div>

      {pendingFolder && (
        <div className="mt-6 flex w-[380px] flex-col gap-2">
          <p className="truncate text-[12px] text-[#666]">
            Saving to {pendingFolder}
          </p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNewDrama()
                if (e.key === 'Escape') cancelNewDrama()
              }}
              placeholder="Drama name"
              className="h-9 flex-1 rounded-md border border-border bg-bg px-3 text-[13px] text-white outline-none transition-colors placeholder:text-[#555] focus:border-[#444]"
            />
            <button
              onClick={confirmNewDrama}
              disabled={busy || !name.trim()}
              className={PRIMARY_BTN}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-[12px] text-red-400">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// STATE 2 — project loaded (drama management)
// ---------------------------------------------------------------------------

function DramaManager({ project, projectPath, setProject, onOpenEditor }) {
  const [adding, setAdding] = useState(false)
  const [newSubfolder, setNewSubfolder] = useState('')
  const [showUpload, setShowUpload] = useState(false)

  // Persist immediately on every change, and reflect it in lifted state.
  async function persist(updated) {
    setProject(updated)
    try {
      await writeProject(projectPath, updated)
    } catch (e) {
      console.error('Failed to persist project.json', e)
    }
  }

  // Save the per-account upload manifest back into project.json.
  function saveUploadManifest(accountId, manifest) {
    persist({
      ...project,
      uploads: { ...(project.uploads || {}), [accountId]: manifest },
    })
  }

  function addSubfolder() {
    const name = newSubfolder.trim()
    if (!name) return
    if (!project.subfolders.includes(name)) {
      persist({ ...project, subfolders: [...project.subfolders, name] })
    }
    setNewSubfolder('')
  }

  function deleteSubfolder(name) {
    persist({
      ...project,
      subfolders: project.subfolders.filter((s) => s !== name),
    })
  }

  const clipCountFor = (name) =>
    project.clips.filter((c) => c.folders?.includes(name)).length

  const subCount = project.subfolders.length
  const clipCount = project.clips.length

  return (
    <div className="flex h-full w-full bg-bg text-white">
      {/* Sidebar */}
      <aside className="flex h-full w-[240px] flex-col border-r border-border bg-surface">
        <div className="px-4 pt-4">
          <p className="text-[11px] uppercase tracking-wide text-[#666]">drama</p>
          <h2 className="mt-1 truncate text-[20px] font-medium leading-tight">
            {project.drama}
          </h2>
        </div>

        <div className="mt-6 flex items-center justify-between px-4">
          <span className="text-[11px] uppercase tracking-wide text-[#666]">
            Subfolders
          </span>
          <button
            onClick={() => setAdding((v) => !v)}
            className="grid h-5 w-5 cursor-pointer place-items-center rounded text-[#666] transition-colors hover:bg-[#1a1a1a] hover:text-white"
            aria-label="Add subfolder"
          >
            <PlusIcon size={14} />
          </button>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {project.subfolders.map((name) => (
            <div
              key={name}
              className="group flex items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-[#1a1a1a]"
            >
              <span className="truncate text-[14px]">{name}</span>
              <button
                onClick={() => deleteSubfolder(name)}
                className="ml-2 shrink-0 cursor-pointer text-[#666] opacity-0 transition-colors hover:text-white group-hover:opacity-100"
                aria-label={`Delete ${name}`}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))}

          {adding && (
            <input
              autoFocus
              value={newSubfolder}
              onChange={(e) => setNewSubfolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSubfolder()
                if (e.key === 'Escape') {
                  setAdding(false)
                  setNewSubfolder('')
                }
              }}
              onBlur={() => {
                if (!newSubfolder.trim()) setAdding(false)
              }}
              placeholder="New subfolder"
              className="mt-1 h-8 w-full rounded border border-border bg-bg px-2 text-[14px] text-white outline-none transition-colors placeholder:text-[#555] focus:border-[#444]"
            />
          )}
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <button onClick={onOpenEditor} className={`w-full ${PRIMARY_BTN}`}>
            Open in Editor
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className={`w-full ${SECONDARY_BTN}`}
          >
            Upload to MEGA
          </button>
        </div>
      </aside>

      {showUpload && (
        <MegaUploadPanel
          project={project}
          onClose={() => setShowUpload(false)}
          onManifestUpdate={saveUploadManifest}
        />
      )}

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-y-auto p-8">
        <header>
          <h1 className="text-[20px] font-medium">{project.drama}</h1>
          <p className="mt-1 text-[12px] text-[#666]">
            {subCount} {subCount === 1 ? 'subfolder' : 'subfolders'} · {clipCount}{' '}
            {clipCount === 1 ? 'clip' : 'clips'}
          </p>
        </header>

        {subCount === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[14px] text-[#666]">Add a subfolder to get started</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-3">
            {project.subfolders.map((name) => {
              const count = clipCountFor(name)
              return (
                <div
                  key={name}
                  className="rounded-md border border-border bg-surface p-4 transition-colors hover:bg-[#1a1a1a]"
                >
                  <FolderIcon size={20} className="text-[#888]" />
                  <p className="mt-3 truncate text-[14px]">{name}</p>
                  <p className="mt-0.5 text-[12px] text-[#666]">
                    {count} {count === 1 ? 'clip' : 'clips'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
