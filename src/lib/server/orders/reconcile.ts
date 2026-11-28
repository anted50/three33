import { and, eq, lt } from 'drizzle-orm'
import { db } from '~/db'
import { orders } from '~/db/schema'
import { assert } from '~/lib/assert'
import { expireCheckout, retireOrder } from './expire'
import { settleOrder, type SettleOutcome } from './settle'

/**
 * Order payment reconciliation, across every provider (QPay, StorePay).
 *
 * Exists for the orders where no request ever came — dropped callback,
 * customer closed the tab, provider retry exhausted — so it cannot wait for
 * one. It runs on a Cron Trigger (src/server.ts) or from outside through
 * POST /api/v1/jobs/reconcile (`npm run job -- reconcile`).
 *
 * Safe to run concurrently with a live callback, or with itself: both paths go
 * through settleOrder, and payments_payment_id_key lets exactly one of them win.
 */

/** Grace period: an invoice younger than this may simply still be in progress. */
const STALE_AFTER_MS = 10 * 60 * 1000

/**
 * How long past its deadline the sweep keeps retrying a cancel the provider
 * refuses. Each hourly run in that window also checks for payment, so money
 * that arrives is settled. After it, the order is retired anyway, with a
 * loud log line: an order must not sit pending forever because a provider
 * keeps failing.
 */
const CANCEL_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000

/** Orders looked at per run; the next hourly run takes the rest. */
const RECONCILE_ORDERS_MAX = 500

/** Per-outcome counts: settleOrder's outcomes, plus `expired`, `cancel_failed` and `error`. */
export interface ReconcileTally {
  checked: number
  error: number
  [outcome: string]: number
}

export async function reconcileOrders(): Promise<ReconcileTally> {
  const now = Date.now()

  const stale = await db
    .select({
      orderNo: orders.orderNo,
      id: orders.id,
      expiresAt: orders.expiresAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'pending_payment'),
        lt(orders.createdAt, new Date(now - STALE_AFTER_MS)),
      ),
    )
    // Uses orders_status_created_at_idx.
    .limit(RECONCILE_ORDERS_MAX)

  assert(stale.length <= RECONCILE_ORDERS_MAX, 'the sweep reads at most RECONCILE_ORDERS_MAX orders')
  const tally: ReconcileTally = { checked: stale.length, error: 0 }

  if (stale.length === 0) {
    console.log('reconcile: nothing pending')
    return tally
  }

  console.log(`reconcile: checking ${stale.length} stale order(s)`)

  for (const order of stale) {
    try {
      const outcome = await reconcileOne(order, now)
      tally[outcome] = (tally[outcome] ?? 0) + 1
    } catch (error) {
      // One bad order must not stop the sweep for the rest.
      tally.error++
      console.error(`  ${order.orderNo}: failed`, error)
    }
  }

  console.log('reconcile:', JSON.stringify(tally))
  return tally
}

/** Settles one stale order, or retires it once its invoice window has passed. */
async function reconcileOne(
  order: { orderNo: string; id: string; expiresAt: Date },
  now: number,
): Promise<SettleOutcome | 'expired' | 'cancel_failed'> {
  const outcome = await settleOrder(order.orderNo)

  if (outcome === 'settled') {
    console.log(`  ${order.orderNo}: SETTLED (callback never arrived)`)
    return outcome
  }
  if (outcome === 'underpaid') {
    console.log(`  ${order.orderNo}: UNDERPAID — needs a human`)
    return outcome
  }

  /**
   * `not_found` counts as retirable. It means a pending order with no usable
   * payment row — settleOrder can never do anything but repeat that answer,
   * so treating it as "still in progress" left the order pending forever.
   * Expiring it is the only outcome that terminates.
   */
  const lapsed = order.expiresAt.getTime() < now
  const retirable = outcome === 'unpaid' || outcome === 'not_found'
  if (!lapsed) return outcome
  if (!retirable) return outcome

  return expireLapsedOrder(order, now)
}

/** Cancels a lapsed order's invoice and retires the order. */
async function expireLapsedOrder(
  order: { orderNo: string; id: string; expiresAt: Date },
  now: number,
): Promise<'expired' | 'cancel_failed' | 'already_settled'> {
  const result = await expireCheckout(order.id, 'expired')

  if (result === 'retired') {
    console.log(`  ${order.orderNo}: expired, invoice cancelled`)
    return 'expired'
  }
  if (result === 'not_pending') {
    return 'already_settled'
  }

  // cancel_failed: the order is still pending, so the next run tries again.
  const lapsedForMs = now - order.expiresAt.getTime()
  if (lapsedForMs < CANCEL_RETRY_WINDOW_MS) {
    console.warn(`  ${order.orderNo}: invoice not cancelled, retrying next run`)
    return 'cancel_failed'
  }

  // A day of failed cancels: give up on the provider and retire the order.
  if (await retireOrder(order.id, 'expired')) {
    console.error(`  ${order.orderNo}: EXPIRED WITHOUT CANCELLING ITS INVOICE — check it with the provider`)
    return 'expired'
  }
  return 'already_settled'
}
