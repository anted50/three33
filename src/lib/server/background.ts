import { waitUntil } from 'cloudflare:workers'

/**
 * Runs `task` after the response has gone out, without making the caller
 * wait for it — the receipt e-mail after a settlement, say.
 *
 * On Workers a promise nobody awaits is not guaranteed to finish: once the
 * response is sent the isolate may stop running it. waitUntil keeps the
 * request alive until the task settles. Failures are logged, never thrown —
 * a background side effect must not turn a completed request into an error.
 */
export function inBackground(label: string, task: Promise<unknown>): void {
  waitUntil(
    task.catch((error) => {
      console.error(`${label}: failed`, error)
    }),
  )
}
