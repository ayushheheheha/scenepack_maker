// MEGA account management (main process).
//
// Stores multiple MEGA accounts locally in userData/mega-accounts.json.
// Passwords are encrypted at rest with Electron safeStorage (OS keychain/DPAPI)
// when available. "Make active" logs the account in — any login counts as
// activity with MEGA, which resets the inactivity clock that can otherwise lead
// to data deletion on idle free accounts.
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { readFile, writeFile, mkdir } = require('node:fs/promises')
const { app, safeStorage } = require('electron')

const STORE_FILE = () => path.join(app.getPath('userData'), 'mega-accounts.json')

async function loadStore() {
  try {
    const raw = await readFile(STORE_FILE(), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data.accounts) ? data : { accounts: [] }
  } catch {
    return { accounts: [] }
  }
}

async function saveStore(store) {
  const file = STORE_FILE()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf-8')
}

function encryptSecret(plain) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { value: safeStorage.encryptString(plain).toString('base64'), encrypted: true }
    }
  } catch {
    /* fall through to plaintext */
  }
  return { value: Buffer.from(plain, 'utf8').toString('base64'), encrypted: false }
}

function decryptSecret(value, encrypted) {
  const buf = Buffer.from(value, 'base64')
  if (encrypted) return safeStorage.decryptString(buf)
  return buf.toString('utf8')
}

// Public shape sent to the renderer (never includes the password).
function toPublic(a) {
  return {
    id: a.id,
    label: a.label || '',
    email: a.email,
    type: a.type || null,
    spaceUsed: a.spaceUsed ?? null,
    spaceTotal: a.spaceTotal ?? null,
    lastActive: a.lastActive || null,
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out — check your connection`)), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

function friendlyError(e) {
  const msg = (e && (e.message || String(e))) || 'Unknown error'
  if (/EMFAREQUIRED|-26|two.?factor|multi.?factor/i.test(msg)) {
    return 'This account has 2FA enabled — enter the current 6-digit code and try again.'
  }
  if (/ENOENT \(-9\)|-9\b|EARGS|wrong|invalid|password|EACCESS|-15/i.test(msg)) {
    return 'Login failed — check the email and password.'
  }
  if (/getaddrinfo|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed/i.test(msg)) {
    return 'Network error reaching MEGA. Check your internet connection.'
  }
  return msg
}

// Log in (autoload:false → no file-tree load) and fetch quota. Resolves the
// account info; closes the session afterwards.
function loginAndInfo({ email, password, secondFactorCode }) {
  const { Storage } = require('megajs')
  return new Promise((resolve, reject) => {
    let settled = false
    let storage = null
    const finish = (err, info) => {
      if (settled) return
      settled = true
      try {
        if (storage) storage.close()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(info)
    }
    const opts = { email, password, autoload: false }
    if (secondFactorCode) opts.secondFactorCode = String(secondFactorCode).trim()
    try {
      storage = new Storage(opts)
    } catch (e) {
      return finish(e)
    }
    storage.on('error', (e) => finish(e)) // prevent unhandled 'error' crash
    withTimeout(storage.ready, 45000, 'MEGA login')
      .then(() => withTimeout(storage.getAccountInfo(), 30000, 'MEGA account info'))
      .then((info) => finish(null, info))
      .catch((e) => finish(e))
  })
}

// ---- public API ----

async function listAccounts() {
  const store = await loadStore()
  return store.accounts.map(toPublic)
}

async function addAccount({ label, email, password, secondFactorCode } = {}) {
  email = (email || '').trim()
  if (!email || !password) throw new Error('Email and password are required.')

  const store = await loadStore()
  if (store.accounts.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('That account is already added.')
  }

  let info
  try {
    info = await loginAndInfo({ email, password, secondFactorCode })
  } catch (e) {
    throw new Error(friendlyError(e))
  }

  const secret = encryptSecret(password)
  const account = {
    id: randomUUID(),
    label: (label || '').trim(),
    email,
    password: secret.value,
    encrypted: secret.encrypted,
    type: info.type,
    spaceUsed: info.spaceUsed,
    spaceTotal: info.spaceTotal,
    lastActive: new Date().toISOString(),
  }
  store.accounts.push(account)
  await saveStore(store)
  return toPublic(account)
}

async function removeAccount(id) {
  const store = await loadStore()
  store.accounts = store.accounts.filter((a) => a.id !== id)
  await saveStore(store)
  return true
}

// Log the account in (keep-alive) and refresh its storage stats.
async function makeActive(id, secondFactorCode) {
  const store = await loadStore()
  const account = store.accounts.find((a) => a.id === id)
  if (!account) throw new Error('Account not found.')

  let password
  try {
    password = decryptSecret(account.password, account.encrypted)
  } catch {
    throw new Error('Could not read the stored password for this account.')
  }

  let info
  try {
    info = await loginAndInfo({ email: account.email, password, secondFactorCode })
  } catch (e) {
    throw new Error(friendlyError(e))
  }

  account.type = info.type
  account.spaceUsed = info.spaceUsed
  account.spaceTotal = info.spaceTotal
  account.lastActive = new Date().toISOString()
  await saveStore(store)
  return toPublic(account)
}

// Open a ready, fully-loaded Storage session for an account (used by the
// uploader, which needs the file tree to create/find folders). Caller must
// call storage.close() when done.
async function loginStorage(id, secondFactorCode) {
  const store = await loadStore()
  const account = store.accounts.find((a) => a.id === id)
  if (!account) throw new Error('Account not found.')
  const password = decryptSecret(account.password, account.encrypted)
  const { Storage } = require('megajs')
  const opts = { email: account.email, password, autoload: true }
  if (secondFactorCode) opts.secondFactorCode = String(secondFactorCode).trim()
  const storage = new Storage(opts)
  storage.on('error', () => {}) // avoid unhandled 'error' crash
  try {
    await withTimeout(storage.ready, 90000, 'MEGA login')
  } catch (e) {
    try {
      storage.close()
    } catch {
      /* ignore */
    }
    throw new Error(friendlyError(e))
  }
  return { storage, account }
}

module.exports = { listAccounts, addAccount, removeAccount, makeActive, loginStorage }
