import { createFileRoute } from '@tanstack/react-router'
import { jobToken } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { runJob } from '~/lib/server/jobs'

/**
 * POST /api/v1/jobs/cleanup
 *
 * Deletes expired sessions, OTP codes and guest carts, and checkout
 * attempts older than 7 days. No external calls.
 * Also runs on the server's own timer — see docs/scheduled-jobs.md.
 *
 * Auth   Authorization: Bearer <JOBS_API_TOKEN> (jobToken). No body.
 * 200    { job, durationMs, result }
 *        result [{ task, ok, error? }] — one per table
 * 401    UNAUTHORIZED       missing or wrong token
 * 409    JOB_RUNNING        already running on this instance
 * 500    JOB_FAILED         some part failed; details = { durationMs, result }
 * 503    JOBS_API_DISABLED  JOBS_API_TOKEN is not set
 */
export const Route = createFileRoute('/api/v1/jobs/cleanup')({
  server: {
    middleware: [jobToken],
    handlers: {
      POST: () => handle(() => runJob('cleanup')),
    },
  },
})
