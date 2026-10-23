import handler from '@tanstack/react-start/server-entry'
import { ApiError } from '~/lib/server/api/errors'
import { type JobName, runJob } from '~/lib/server/jobs'

/**
 * The Worker entry (wrangler.jsonc `main`).
 *
 * `fetch` is TanStack Start's handler — SSR, server functions and the API
 * routes. Static files in public/ and the hashed client bundle never reach it:
 * Workers static assets serve them first.
 *
 * `scheduled` is the clock. It replaces the Node server's setInterval timers;
 * the jobs themselves are the same functions POST /api/v1/jobs/* runs.
 */

/**
 * Cron expression -> job. Must match `triggers.crons` in wrangler.jsonc
 * exactly — Cloudflare hands the expression back verbatim, and an unmatched
 * one is logged as an error rather than guessed at.
 */
const CRON_JOBS: Record<string, JobName> = {
  '*/5 * * * *': 'booking-sweep',
  '7 * * * *': 'reconcile',
  '17 19 * * *': 'cleanup',
}

async function runScheduled(cron: string): Promise<void> {
  const job = CRON_JOBS[cron]
  if (!job) {
    console.error(`[cron] no job mapped to "${cron}" — check CRON_JOBS in src/server.ts`)
    return
  }

  try {
    const run = await runJob(job)
    console.log(JSON.stringify({ event: 'scheduled_job_finished', job, outcome: 'succeeded', durationMs: run.durationMs }))
  } catch (error) {
    // The previous run is still going (a slow sweep meeting its next tick).
    // Same as the old timers: skip this tick, it is not a failure.
    if (error instanceof ApiError && error.code === 'JOB_RUNNING') {
      console.warn(`[cron] ${job}: still running, skipping this tick`)
      return
    }
    console.error(JSON.stringify({ event: 'scheduled_job_finished', job, outcome: 'failed', error: String(error) }))
    // Rethrown so the invocation shows as failed in the Workers dashboard.
    throw error
  }
}

export default {
  // Not `fetch: handler.fetch` — its second parameter is TanStack's request
  // options, and Workers would pass `env` there. Bindings are read through
  // process.env (nodejs_compat) instead.
  fetch: (request) => handler.fetch(request),

  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron))
  },
} satisfies ExportedHandler<Env>
