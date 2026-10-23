import { ApiError, conflict } from './api/errors'
import { sweepBooking } from './booking/sweep'
import { runCleanup } from './maintenance'
import { reconcileOrders } from './orders/reconcile'

/**
 * The scheduled jobs, callable over HTTP (POST /api/v1/jobs/<name>).
 *
 * The same functions the in-process timers in server/index.mjs reach through
 * scripts/*.ts — one code path whichever way a run starts. The list of what
 * exists and why is docs/scheduled-jobs.md.
 *
 * Over HTTP a job runs inline in the web process, not as a child process. Each
 * one already isolates its own failures per row or per task, so a bad order
 * fails that order, not the request.
 */

export type JobName = 'reconcile' | 'booking-sweep' | 'cleanup'

interface JobReport {
  /** False when some part failed — the same case a script exits 1 on. */
  ok: boolean
  result: unknown
}

const JOBS: Record<JobName, () => Promise<JobReport>> = {
  reconcile: async () => {
    const tally = await reconcileOrders()
    return { ok: tally.error === 0, result: tally }
  },
  'booking-sweep': async () => {
    const tally = await sweepBooking()
    return { ok: tally.errors === 0, result: tally }
  },
  cleanup: async () => {
    const outcomes = await runCleanup()
    return {
      ok: outcomes.every((o) => o.ok),
      // `error` is an arbitrary thrown value; only its message is fit for JSON.
      result: outcomes.map(({ task, ok, error }) =>
        ok ? { task, ok } : { task, ok, error: error instanceof Error ? error.message : String(error) },
      ),
    }
  },
}

/**
 * Runs in this process right now. Not across replicas or against the
 * in-process timers' child processes — every job is safe to race, so this only
 * stops a scheduler that retries on timeout from stacking runs on one instance.
 */
const running = new Set<JobName>()

export interface JobRun {
  job: JobName
  durationMs: number
  result: unknown
}

/**
 * 200 with the job's tally, 409 JOB_RUNNING if this instance is already
 * running it, 500 JOB_FAILED (tally in `details`) if any part of it failed.
 */
export async function runJob(job: JobName): Promise<JobRun> {
  if (running.has(job)) {
    throw conflict('JOB_RUNNING', `${job} is already running on this instance`)
  }

  running.add(job)
  const startedAt = Date.now()
  try {
    const { ok, result } = await JOBS[job]()
    const durationMs = Date.now() - startedAt
    console.log(`[jobs-api] ${job}: ${ok ? 'ok' : 'finished with failures'} (${durationMs}ms)`)
    if (!ok) {
      throw new ApiError(500, 'JOB_FAILED', `${job} finished with failures`, { durationMs, result })
    }
    return { job, durationMs, result }
  } finally {
    running.delete(job)
  }
}
