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
    tsconfigPaths: true,
  },
  plugins: [tanstackStart(), viteReact()],
})
