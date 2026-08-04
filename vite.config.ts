import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

/**
 * Deliberately does NOT load .env here.
 *
 * It used to, and .env's `NODE_ENV=development` then won over the build mode
 * that `vite build` sets — so the production bundle was compiled with React's
 * development JSX transform and every SSR route died at runtime with
 * "jsxDEV is not a function". The build itself reported success.
 *
 * The modules that actually need environment variables (src/db/index.ts,
 * src/lib/server/env.ts) load .env themselves at import time, which is both
 * narrower and immune to this.
 */
/**
 * Build with `npm run build`, never `vite build` directly — see
 * scripts/build.mjs. NODE_ENV has to be production before @vitejs/plugin-react
 * is imported, which is earlier than anything this file can influence.
 */
export default defineConfig(() => {
  return {
    server: {
      port: 3000,
    /**
     * Vite rejects requests whose Host header it does not recognise, which is
     * right for localhost but blocks tunnels — a Cloudflare or ngrok hostname
     * gets a bare "Blocked request" page that looks like the app is broken.
     *
     * Bare IPs (phone on the same Wi-Fi) are allowed without this; these two
     * entries are only so `cloudflared tunnel --url http://localhost:3000`
     * works, which is also how QPay callbacks can reach a dev machine.
     */
      allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'],
    },
    resolve: {
      // Explicit rather than relying on resolve.tsconfigPaths alone, which
      // does not resolve `~/...` for asset imports carrying a `?url` suffix.
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [tanstackStart(), viteReact()],
  }
})
