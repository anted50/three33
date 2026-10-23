import { and, eq, lt } from 'drizzle-orm'
import { db } from '~/db'
import { orders } from '~/db/schema'
import { expireCheckout } from './expire'
import { settleOrder } from './settle'

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

/** Per-outcome counts: settleOrder's outcomes, plus `expired` and `error`. */
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
    .limit(500)

  const tally: ReconcileTally = { checked: stale.length, error: 0 }

  if (stale.length === 0) {
    console.log('reconcile: nothing pending')
    return tally
  }

  console.log(`reconcile: checking ${stale.length} stale order(s)`)

  for (const order of stale) {
    try {
      const outcome = await settleOrder(order.orderNo)
      tally[outcome] = (tally[outcome] ?? 0) + 1

      if (outcome === 'settled') {
        console.log(`  ${order.orderNo}: SETTLED (callback never arrived)`)
        continue
      }

      if (outcome === 'underpaid') {
        console.log(`  ${order.orderNo}: UNDERPAID — needs a human`)
        continue
      }

      /**
       * Retire it once the invoice window has passed.
       *
       * `not_found` counts. It means a pending order with no usable payment row
       * — settleOrder can never do anything but repeat that answer, so treating
       * it as "still in progress" left the order pending forever. Expiring it
       * is the only outcome that terminates.
       */
      const lapsed = order.expiresAt.getTime() < now
      if (lapsed && (outcome === 'unpaid' || outcome === 'not_found')) {
        // expireCheckout cancels the invoice with the provider before touching
        // our row. Skipping that is what left "expired" orders quietly payable
        // for days.
        if (await expireCheckout(order.id, 'expired')) {
          console.log(`  ${order.orderNo}: expired, invoice cancelled`)
          tally.expired = (tally.expired ?? 0) + 1
        }
      }
    } catch (error) {
      // One bad order must not stop the sweep for the rest.
      tally.error++
      console.error(`  ${order.orderNo}: failed`, error)
    }
  }

  console.log('reconcile:', JSON.stringify(tally))
  return tally
}
