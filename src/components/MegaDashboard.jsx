import { useEffect, useState } from 'react'

const GB = 1024 * 1024 * 1024
const fmtGB = (b) => (typeof b === 'number' ? `${(b / GB).toFixed(1)} GB` : '—')

const INPUT =
  'h-9 w-full rounded-md border border-border bg-bg px-3 text-[13px] text-white outline-none transition-colors placeholder:text-[#555] focus:border-[#444]'
const PRIMARY =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50'
const GHOST =
  'inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-2.5 text-[11px] text-white transition-colors hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40'

export default function MegaDashboard({ onClose }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ label: '', email: '', password: '', code: '' })
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [busyId, setBusyId] = useState(null) // account being made-active / removed
  const [rowError, setRowError] = useState({}) // id -> message
  const [rowCode, setRowCode] = useState({}) // id -> 2FA code

  async function refresh() {
    try {
      setAccounts(await window.electronAPI.mega.list())
    } catch (e) {
      console.error('Failed to list MEGA accounts', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.email.trim() || !form.password) return
    setAdding(true)
    setAddError('')
    try {
      const account = await window.electronAPI.mega.add({
        label: form.label,
        email: form.email,
        password: form.password,
        secondFactorCode: form.code,
      })
      setAccounts((prev) => [...prev, account])
      setForm({ label: '', email: '', password: '', code: '' })
    } catch (e) {
      setAddError(e?.message || String(e))
    } finally {
      setAdding(false)
    }
  }

  async function handleMakeActive(id) {
    setBusyId(id)
    setRowError((p) => ({ ...p, [id]: '' }))
    try {
      const updated = await window.electronAPI.mega.makeActive(id, rowCode[id])
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)))
      setRowCode((p) => ({ ...p, [id]: '' }))
    } catch (e) {
      setRowError((p) => ({ ...p, [id]: e?.message || String(e) }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(id) {
    setBusyId(id)
    try {
      await window.electronAPI.mega.remove(id)
      setAccounts((prev) => prev.filter((a) => a.id !== id))
    } catch (e) {
      setRowError((p) => ({ ...p, [id]: e?.message || String(e) }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      onMouseDown={onClose}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[84vh] w-[580px] flex-col rounded-lg border border-border bg-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[15px] font-medium">MEGA Accounts</h2>
            <p className="mt-0.5 text-[11px] text-[#666]">
              Stored locally. Use “Make active” to keep an account from going idle.
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

        {/* Add account */}
        <form onSubmit={handleAdd} className="border-b border-border p-4">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-[#666]">Add account</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={INPUT}
              placeholder="Label (optional)"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
            <input
              className={INPUT}
              type="email"
              placeholder="Email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <input
              className={INPUT}
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <input
              className={INPUT}
              placeholder="2FA code (if enabled)"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 flex-1 truncate text-[12px] text-red-400">{addError}</p>
            <button
              type="submit"
              disabled={adding || !form.email.trim() || !form.password}
              className={PRIMARY}
            >
              {adding ? 'Signing in…' : 'Add account'}
            </button>
          </div>
        </form>

        {/* Accounts list */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {loading ? (
            <p className="text-center text-[12px] text-[#666]">Loading…</p>
          ) : accounts.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[#666]">
              No accounts yet. Add one above.
            </p>
          ) : (
            accounts.map((a) => {
              const used = a.spaceUsed
              const total = a.spaceTotal
              const pct =
                typeof used === 'number' && typeof total === 'number' && total > 0
                  ? Math.min(100, (used / total) * 100)
                  : 0
              const busy = busyId === a.id
              const err = rowError[a.id]
              const needsCode = err && /2fa|code/i.test(err)
              return (
                <div key={a.id} className="rounded-md border border-border bg-bg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {a.label || a.email}
                      </p>
                      {a.label && (
                        <p className="truncate text-[11px] text-[#666]">{a.email}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#888]">
                      {a.type || 'free'}
                    </span>
                  </div>

                  {/* Storage bar */}
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded bg-[#222]">
                      <div
                        className={`h-full ${pct > 90 ? 'bg-red-500' : 'bg-white'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-[#888]">
                      {fmtGB(used)} of {fmtGB(total)} used
                      {typeof used === 'number' && typeof total === 'number' && (
                        <span className="text-[#666]"> · {fmtGB(total - used)} free</span>
                      )}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-[#666]">
                      {a.lastActive
                        ? `Active ${new Date(a.lastActive).toLocaleString()}`
                        : 'Never activated'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {needsCode && (
                        <input
                          className="h-7 w-24 rounded-md border border-border bg-bg px-2 text-[11px] text-white outline-none placeholder:text-[#555] focus:border-[#444]"
                          placeholder="2FA code"
                          value={rowCode[a.id] || ''}
                          onChange={(e) =>
                            setRowCode((p) => ({ ...p, [a.id]: e.target.value }))
                          }
                        />
                      )}
                      <button
                        onClick={() => handleMakeActive(a.id)}
                        disabled={busy}
                        className={GHOST}
                      >
                        {busy ? 'Working…' : 'Make active'}
                      </button>
                      <button
                        onClick={() => handleRemove(a.id)}
                        disabled={busy}
                        className={`${GHOST} border-transparent text-[#888] hover:text-red-400`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {err && <p className="mt-2 text-[11px] text-red-400">{err}</p>}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
