const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const {
  registerMediaSchemePrivileged,
  registerMediaProtocol,
} = require('./mediaProtocol')

const isDev = process.env.NODE_ENV === 'development'
const DEV_SERVER_URL = 'http://localhost:5173'
const PROJECT_FILE = 'project.json'

// Declare the media:// scheme as privileged BEFORE app 'ready'.
registerMediaSchemePrivileged()

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.webContents.on('did-finish-load', () => {
    console.log('[main] renderer loaded')
  })
  console.log(`[main] window created (mode: ${isDev ? 'dev' : 'prod'})`)
}

// ---------------------------------------------------------------------------
// IPC: native dialogs
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:openFile', async (_evt, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    ...options,
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ---------------------------------------------------------------------------
// IPC: filesystem / project I/O
// ---------------------------------------------------------------------------

// Read and parse project.json from a given folder. Throws if missing/invalid.
ipcMain.handle('fs:readProject', async (_evt, folderPath) => {
  const file = path.join(folderPath, PROJECT_FILE)
  const raw = await fs.readFile(file, 'utf-8')
  return JSON.parse(raw)
})

// Write a project object to project.json in a given folder (created if needed).
ipcMain.handle('fs:writeProject', async (_evt, folderPath, project) => {
  await fs.mkdir(folderPath, { recursive: true })
  const file = path.join(folderPath, PROJECT_FILE)
  await fs.writeFile(file, JSON.stringify(project, null, 2), 'utf-8')
  return file
})

// List immediate subfolders inside a root directory.
ipcMain.handle('fs:listDramas', async (_evt, rootPath) => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
})

// Create a directory (and parents) if it doesn't already exist.
ipcMain.handle('fs:ensureDir', async (_evt, dirPath) => {
  await fs.mkdir(dirPath, { recursive: true })
  return dirPath
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerMediaProtocol()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
