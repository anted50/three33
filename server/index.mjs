/**
 * Production server entry.
 *
 * `vite build` emits dist/server/server.js as a Web `fetch` handler — it does
 * not listen on anything. Running it directly starts a process that exits
 * immediately, which on a host like Railway looks like a crash loop with no
 * error. This file is the missing listener.
 *
 * Three jobs:
 *   1. Serve the hashed client assets from dist/client.
 *   2. Hand everything else to the Start handler for SSR and server functions.
 *   3. Run the scheduled jobs — see "Scheduled jobs" below.
 *
 * Not used in development — `vite dev` has its own server.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
  startScheduledJobs()
})

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

/**
 * Everything that has to happen on a clock happens here, because this process
 * is the only thing in the deployment that is reliably always running.
 *
 * Not a server function: those only execute when a request arrives, and the
 * whole point of the reconciliation sweep is the case where no request ever
 * came. Not pg_cron either — the sweep is three outbound HTTPS calls (QPay
 * /payment/check, QPay invoice cancellation, the receipt e-mail), and Postgres
 * has no network stack. That leaves this file.
 *
 * Each job runs as a short-lived child process rather than inline. A sweep
 * that throws, hangs or leaks then cannot take the web server down with it,
 * and the job gets a clean database connection that closes when it exits
 * instead of borrowing the server's pool for an hour.
 *
 * Safe with more than one replica. Both would sweep the same orders, and
 * settleOrder is built for exactly that race — payments_qpay_payment_id_key
 * lets exactly one settlement land. Cleanup is idempotent DELETEs.
 *
 * The authoritative list of what runs, and when, is docs/scheduled-jobs.md.
 */
const JOBS = [
  {
    name: 'reconcile',
    script: '../scripts/reconcile.ts',
    // Hourly. The customer's own polling and the QPay callback settle almost
    // everything; this is the net under the ones neither caught.
    intervalMs: 60 * 60 * 1000,
    // Not at boot: a redeploy would otherwise fire a sweep while the instance
    // is still warming, and every redeploy would spend QPay calls.
    firstRunDelayMs: 5 * 60 * 1000,
  },
  {
    name: 'cleanup',
    script: '../scripts/cleanup.ts',
    // Daily is plenty — nothing here is load-bearing, expiry is enforced at
    // read time and these deletes only reclaim disk.
    intervalMs: 24 * 60 * 60 * 1000,
    firstRunDelayMs: 10 * 60 * 1000,
  },
]

/** The repo root — server/index.mjs lives one level below it. */
const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Jobs currently executing, so a slow run cannot stack on its next tick. */
const running = new Set()

function runJob(job) {
  if (running.has(job.name)) {
    console.warn(`[jobs] ${job.name}: still running, skipping this tick`)
    return
  }

  running.add(job.name)
  const startedAt = Date.now()

  /**
   * `--import tsx` because the jobs are TypeScript sharing src/ with the app,
   * and only the web handler gets bundled into dist/. tsx is a runtime
   * dependency, not a dev one, precisely so this works in production.
   */
  /**
   * Both the script path and the child's working directory are derived from
   * this file rather than inherited. `--import tsx` is resolved from the
   * child's cwd, so without pinning it a server started from anywhere but the
   * repo root fails with "Cannot find package 'tsx'" — and the failure is a
   * job that silently never runs, which is the worst way for a payment sweep
   * to break.
   */
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL(job.script, import.meta.url))],
    { stdio: 'inherit', env: process.env, cwd: ROOT_DIR },
  )

  const finish = (message) => {
    if (!running.has(job.name)) return
    running.delete(job.name)
    console.log(`[jobs] ${job.name}: ${message} (${Date.now() - startedAt}ms)`)
  }

  child.on('exit', (code) =>
    finish(code === 0 ? 'ok' : `exited with code ${code}`),
  )
  // Distinct from a non-zero exit: the process never started at all.
  child.on('error', (error) => finish(`could not start — ${error.message}`))
}

function startScheduledJobs() {
  for (const job of JOBS) {
    setTimeout(() => {
      runJob(job)
      setInterval(() => runJob(job), job.intervalMs)
    }, job.firstRunDelayMs)

    console.log(
      `[jobs] ${job.name}: every ${job.intervalMs / 60000}min, ` +
        `first run in ${job.firstRunDelayMs / 60000}min`,
    )
  }
}
