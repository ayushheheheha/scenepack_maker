import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite serves the renderer (src/) during dev on port 5173 and builds to dist/.
// Electron's main process loads either the dev server URL or dist/index.html.
// base: './' keeps built asset paths relative so loadFile() works when packaged.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
