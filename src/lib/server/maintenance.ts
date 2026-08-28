import { lt } from 'drizzle-orm'
import { db } from '~/db'
import { carts, checkoutAttempts } from '~/db/schema'
import { deleteExpiredOtpCodes } from './auth/otp'
import { deleteExpiredSessions } from './auth/session'

/**
 * Row housekeeping — everything that expires by time and nothing else.
 *
 * One module so the answer to "what gets cleaned up, and when" is a single
 * file rather than a habit spread across five. Two of these functions
 * (deleteExpiredSessions, deleteExpiredOtpCodes) had been written for "the
 * scheduled script" and then never called by anything; this is that script's
 * missing half.
 *
 * Nothing here touches an external service, and nothing here is load-bearing
 * for correctness: expiry is enforced where rows are read, by comparing
 * expires_at, not by the row being absent. Skipping a night costs disk, not
 * correctness — which is why this runs daily and the payment sweep runs hourly.
 */

/**
 * How long an abuse record is worth keeping.
 *
 * The rate limiter only ever counts the last hour (see orders/rate-limit.ts),
 * so a week is not for the limiter — it is for the human looking into a burst
 * of junk orders days after the shop noticed them.
 */
export const CHECKOUT_ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Guest carts past their 30-day TTL. cart_items cascades with the cart. */
export async function deleteExpiredCarts(): Promise<void> {
  await db.delete(carts).where(lt(carts.expiresAt, new Date()))
}

export async function pruneCheckoutAttempts(): Promise<void> {
  await db
    .delete(checkoutAttempts)
    .where(
      lt(
        checkoutAttempts.createdAt,
        new Date(Date.now() - CHECKOUT_ATTEMPT_RETENTION_MS),
      ),
    )
}

export interface CleanupOutcome {
  task: string
  ok: boolean
  error?: unknown
}

/**
 * Runs every housekeeping task, independently.
 *
 * One failing task must not skip the rest — they share a schedule, not a
 * purpose, and a permissions problem on one table is no reason to stop
 * expiring sessions.
 */
export async function runCleanup(): Promise<CleanupOutcome[]> {
  const tasks: Array<[string, () => Promise<void>]> = [
    ['sessions', deleteExpiredSessions],
    ['otp_codes', deleteExpiredOtpCodes],
    ['carts', deleteExpiredCarts],
    ['checkout_attempts', pruneCheckoutAttempts],
  ]

  const results: CleanupOutcome[] = []

  for (const [task, run] of tasks) {
    try {
      await run()
      results.push({ task, ok: true })
    } catch (error) {
      results.push({ task, ok: false, error })
    }
  }

  return results
}
