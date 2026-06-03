# ScenePack Maker

A minimalist desktop app for **clipping and organizing scenes from drama episodes into "scene packs."** Load an episode, mark in/out points, save clips, sort them into subfolders, and export each subfolder as a set of cut video files with one click — all powered by a bundled `ffmpeg`.

Built with Electron + React + Vite + Tailwind, with a flat, Vercel-inspired dark UI. No database — every project is a plain `project.json` file on disk.

![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v3-38BDF8?logo=tailwindcss&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

<!-- Add screenshots here, e.g. ![Editor](docs/editor.png) -->

## Features

- **Project management** — create a new drama or open an existing one. Each drama is a folder containing a `project.json`. Define subfolders (categories/tags) and see clip counts at a glance.
- **Video player** — native HTML5 playback with custom controls: play/pause, `HH:MM:SS:FF` timecode (24 fps), total duration, volume, and playback speed (0.25×–2×). No native browser chrome.
- **Timeline** — a filmstrip of real frames extracted from the loaded video, an adaptive time ruler, **zoom in/out** + horizontal scroll (CapCut-style), and **live scrubbing** that updates the preview as you drag.
- **In / Out markers** — set in/out points by button or keyboard; the selected region is highlighted on the timeline.
- **Clip workspace** — add clips from the current in/out range, each shown with a thumbnail, duration, episode + time range, an editable label, and subfolder chips. Play a clip (auto-stops at its out point) or delete it. Everything autosaves to `project.json`.
- **Export engine** — cuts every clip into `outputDir/<drama>/<subfolder>/` using `ffmpeg`, with per-episode sequential filenames (`ep1_001.mp4`, `ep1_002.mp4`, …). Stream-copy for speed with an automatic re-encode fallback, a live progress bar, and an "Open folder" shortcut when done.

## Tech stack

| Area        | Choice                                            |
| ----------- | ------------------------------------------------- |
| Desktop     | [Electron](https://www.electronjs.org/)           |
| UI          | [React](https://react.dev/) + [Vite](https://vite.dev/) |
| Styling     | [Tailwind CSS](https://tailwindcss.com/) v3       |
| Video       | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) + [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) |
| Packaging   | [electron-builder](https://www.electron.build/)   |
| Storage     | Plain `project.json` files (no database)          |

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org/) ≥ 20.19 (or ≥ 22.12) and npm.

```bash
# install dependencies
npm install

# run in development (Vite dev server + Electron with hot reload)
npm run dev
```

`npm run dev` starts Vite on port `5173` and launches Electron pointed at it.

### Scripts

| Script            | What it does                                            |
| ----------------- | ------------------------------------------------------- |
| `npm run dev`     | Vite dev server + Electron (hot reload for the renderer) |
| `npm run build`   | Build the renderer to `dist/`                           |
| `npm run preview` | Preview the production renderer build in a browser      |
| `npm run dist`    | Build the renderer **and** package the app installer    |

## Building a distributable

```bash
npm run dist
```

Output lands in `release/`. On Windows you get:

- `release/ScenePack Maker Setup <version>.exe` — the NSIS installer to share.
- `release/win-unpacked/` — a portable, already-unpacked build.

> **Cross-platform:** you can only build the Windows installer on Windows, the macOS `.dmg` on macOS, and the Linux `AppImage` on Linux (or use CI to build all three). Targets are configured in [`electron-builder.config.js`](electron-builder.config.js).

> **Code signing:** builds are unsigned by default, so Windows SmartScreen shows an "unknown publisher" prompt (**More info → Run anyway**) and macOS Gatekeeper will block them. Add a signing certificate for public distribution.

## Project structure

```
scenepack-maker/
├─ electron/
│  ├─ main.js           # Electron main process + IPC handlers
│  ├─ preload.js        # contextBridge → window.electronAPI
│  ├─ mediaProtocol.js  # media:// scheme (range-capable local video streaming)
│  ├─ exportEngine.js   # ffmpeg cutting / per-subfolder export
│  └─ thumbnails.js     # ffmpeg single-frame extraction (filmstrip + clip thumbs)
├─ scripts/
│  └─ dev-electron.js   # dev launcher (see Troubleshooting)
├─ src/
│  ├─ App.jsx           # top-level view switch + lifted project state
│  ├─ pages/            # Home.jsx, Editor.jsx
│  ├─ components/       # Timeline, ClipCard, ExportPanel, Icons
│  └─ utils/            # projectIO, time, media helpers
├─ index.html
├─ vite.config.js
├─ tailwind.config.js
├─ postcss.config.js
└─ electron-builder.config.js
```

## Keyboard shortcuts (Editor)

| Key       | Action                       |
| --------- | ---------------------------- |
| `Space`   | Play / pause                 |
| `I`       | Set in point                 |
| `O`       | Set out point                |
| `←` / `→` | Step back / forward 1 frame  |
| `J` / `L` | Jump back / forward 5 seconds |

## `project.json` format

```jsonc
{
  "drama": "We are all trying here",
  "createdAt": "2026-06-03T00:00:00.000Z",
  "subfolders": ["romance", "fight", "comedy"],
  "clips": [
    {
      "id": "clip_1717000000000",
      "episode": "episode 1",        // used as the export filename prefix
      "sourcePath": "C:/videos/ep1.mp4", // absolute path to the source video
      "in": 12.5,                    // in point, seconds
      "out": 30.0,                   // out point, seconds
      "folders": ["romance"],        // subfolders this clip belongs to
      "label": "first meeting",
      "exported": true               // set after a successful export
    }
  ]
}
```

## How it works

- **Local video playback** is served through a custom **`media://`** scheme registered in the main process, because Chromium blocks `file://` resources from the dev server's `http://` origin. The scheme supports HTTP range requests so the player can seek smoothly.
- **Thumbnails** (filmstrip + clip cards) are extracted by **ffmpeg in the main process**, which is robust across codecs and avoids canvas cross-origin tainting.
- **Export** runs entirely in the main process: it creates `outputDir/<drama>/<subfolder>/`, sorts each subfolder's clips by episode then in-point, and cuts them with `ffmpeg -ss <in> -t <duration> -c copy` (falling back to `-c:v libx264 -c:a aac` when stream-copy isn't compatible).

## Troubleshooting

- **`npm run dev` fails with "Cannot read properties of undefined (reading 'handle')"** — your environment exported `ELECTRON_RUN_AS_NODE=1` (some IDE terminals do), which makes Electron run as plain Node. The dev launcher [`scripts/dev-electron.js`](scripts/dev-electron.js) strips it; if you bypass that script, unset the variable.
- **`npm run dist` fails on Windows with "Cannot create symbolic link … A required privilege is not held"** — electron-builder's signing toolchain contains macOS symlinks that Windows can't extract without privilege. **Enable Windows Developer Mode** (Settings → System → For developers → Developer Mode **On**) or run the build once from an Administrator terminal, then retry.
- **A video plays but its thumbnail/frames are blank** — the frame couldn't be decoded (rare); the app falls back to a dark placeholder. `H.264 .mp4` is the most reliable source format.

## License

[MIT](LICENSE)
