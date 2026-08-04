/**
 * Production server entry.
 *
 * `vite build` emits dist/server/server.js as a Web `fetch` handler — it does
 * not listen on anything. Running it directly starts a process that exits
 * immediately, which on a host like Railway looks like a crash loop with no
 * error. This file is the missing listener.
 *
 * Two jobs:
 *   1. Serve the hashed client assets from dist/client.
 *   2. Hand everything else to the Start handler for SSR and server functions.
 *
 * Not used in development — `vite dev` has its own server.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import handler from '../dist/server/server.js'

const app = new Hono()

/**
 * Vite fingerprints these filenames, so they are safe to cache forever. Without
 * this header every asset is re-fetched on each visit.
 */
app.use(
  '/assets/*',
  serveStatic({
    root: './dist/client',
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=31536000, immutable')
    },
  }),
)

/** Everything else in dist/client: favicon, product packshots, robots.txt. */
app.use('/*', serveStatic({ root: './dist/client' }))

/**
 * SSR and server functions. The static middleware above falls through when a
 * file does not exist, so this only sees real application routes.
 */
app.all('/*', (c) => handler.fetch(c.req.raw))

// Railway (and most hosts) inject PORT. Binding to 0.0.0.0 rather than
// localhost is what makes the container reachable from outside itself.
const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`uppercut listening on http://0.0.0.0:${info.port}`)
})
