import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { loadDotEnv } from './src/lib/load-dot-env'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

// Vite only exposes VITE_-prefixed vars to import.meta.env; our server code
// reads process.env directly, so .env has to be loaded into the process itself.
loadDotEnv()

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    // Explicit rather than relying on resolve.tsconfigPaths alone, which does
    // not resolve `~/...` for asset imports carrying a `?url` suffix.
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [tanstackStart(), viteReact()],
})
