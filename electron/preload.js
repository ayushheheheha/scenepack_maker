const { contextBridge, ipcRenderer } = require('electron')

// Expose a minimal, typed surface to the renderer as window.electronAPI.
// The renderer never touches Node or the filesystem directly — every call
// is forwarded to a matching ipcMain.handle() in main.js.
contextBridge.exposeInMainWorld('electronAPI', {
  // Dialogs
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // Project / filesystem
  readProject: (folderPath) => ipcRenderer.invoke('fs:readProject', folderPath),
  writeProject: (folderPath, project) =>
    ipcRenderer.invoke('fs:writeProject', folderPath, project),
  listDramas: (rootPath) => ipcRenderer.invoke('fs:listDramas', rootPath),
  ensureDir: (dirPath) => ipcRenderer.invoke('fs:ensureDir', dirPath),

  // Thumbnails — extract a frame (data URL) at a timestamp via ffmpeg.
  extractThumbnail: (filePath, time, width) =>
    ipcRenderer.invoke('thumb:extract', filePath, time, width),

  // Export
  startExport: (payload) => ipcRenderer.invoke('export:start', payload),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  // Subscribe to export progress; returns an unsubscribe function.
  onExportProgress: (callback) => {
    const listener = (_evt, data) => callback(data)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
})
