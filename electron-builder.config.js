/**
 * electron-builder configuration.
 * Packaging is not exercised in Phase 1 — this is wired up for later phases.
 * ffmpeg-static ships a platform binary that must be unpacked from the asar.
 */
module.exports = {
  appId: 'com.scenepack.maker',
  productName: 'ScenePack Maker',
  // App icon for all platforms. electron-builder converts this 1254x1254 PNG
  // to .ico (Windows) / .icns (macOS) automatically.
  icon: 'icon.png',
  directories: {
    output: 'release',
  },
  files: ['dist/**/*', 'electron/**/*', 'icon.png', 'package.json'],
  // ffmpeg binary cannot run from inside the asar archive.
  asarUnpack: ['**/node_modules/ffmpeg-static/**'],
  win: {
    target: 'nsis',
  },
  mac: {
    target: 'dmg',
  },
  linux: {
    target: 'AppImage',
  },
}
