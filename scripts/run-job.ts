/**
 * Triggers a scheduled job by hand, through the same endpoint an external
 * scheduler would use (POST /api/v1/jobs/<name>, see docs/scheduled-jobs.md).
 *
 * Usage:
 *   npm run job -- reconcile                                 the local dev server
 *   npm run job -- cleanup --url https://three33barber.com   a deployed Worker
 *
 * Needs JOBS_API_TOKEN — from the environment, .dev.vars or .env — matching
 * the server's. The jobs need the Worker's bindings, which is why this goes
 * over HTTP instead of importing them.
 */
import { loadDotEnv } from '../src/lib/load-dot-env'

loadDotEnv()

const JOBS = ['reconcile', 'booking-sweep', 'cleanup']
const args = process.argv.slice(2)
const job = args.find((a) => JOBS.includes(a))
const urlFlag = args.indexOf('--url')
const base = urlFlag >= 0 ? args[urlFlag + 1] : 'http://localhost:3000'
const token = process.env.JOBS_API_TOKEN

if (!job || !base) {
  console.error(`Usage: npm run job -- <${JOBS.join('|')}> [--url <base url>]`)
  process.exit(1)
}
if (!token) {
  console.error('job: JOBS_API_TOKEN is not set (environment, .dev.vars or .env)')
  process.exit(1)
}

const response = await fetch(new URL(`/api/v1/jobs/${job}`, base), {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
})
console.log(`job: ${job} -> ${response.status}`)
console.log(JSON.stringify(await response.json(), null, 2))
process.exit(response.ok ? 0 : 1)
