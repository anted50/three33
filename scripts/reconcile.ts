/**
 * QPay reconciliation sweep. Runs on host cron, hourly — NOT as a server
 * function, because server functions only execute when a request arrives and
 * the entire purpose of this script is to catch orders where no request ever
 * came (dropped callback, customer closed the tab, QPay retry exhausted).
 *
 * Safe to run concurrently with a live callback: both paths go through
 * settleOrder, and payments_qpay_payment_id_key lets exactly one of them win.
 */
import { and, eq, lt } from 'drizzle-orm'
import { db } from '~/db'
import { orders } from '~/db/schema'
import { settleOrder } from '~/lib/server/orders/settle'
import { assertTransition } from '~/lib/server/orders/state'

/** Grace period: an invoice younger than this may simply still be in progress. */
const STALE_AFTER_MS = 10 * 60 * 1000

/** After this long unpaid, the invoice is written off. */
const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000

async function main() {
  const now = Date.now()

  const stale = await db
    .select({
      orderNo: orders.orderNo,
      id: orders.id,
      createdAt: orders.createdAt,
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

  if (stale.length === 0) {
    console.log('reconcile: nothing pending')
    return
  }

  console.log(`reconcile: checking ${stale.length} stale order(s)`)

  const tally: Record<string, number> = {}

  for (const order of stale) {
    try {
      const outcome = await settleOrder(order.orderNo)
      tally[outcome] = (tally[outcome] ?? 0) + 1

      if (outcome === 'settled') {
        console.log(`  ${order.orderNo}: SETTLED (callback never arrived)`)
      } else if (outcome === 'underpaid') {
        console.log(`  ${order.orderNo}: UNDERPAID — needs a human`)
      } else if (
        outcome === 'unpaid' &&
        order.createdAt.getTime() < now - EXPIRE_AFTER_MS
      ) {
        assertTransition('pending_payment', 'expired')
        await db
          .update(orders)
          .set({ status: 'expired' })
          .where(eq(orders.id, order.id))
        console.log(`  ${order.orderNo}: expired`)
        tally.expired = (tally.expired ?? 0) + 1
      }
    } catch (error) {
      // One bad order must not stop the sweep for the rest.
      tally.error = (tally.error ?? 0) + 1
      console.error(`  ${order.orderNo}: failed`, error)
    }
  }

  console.log('reconcile:', JSON.stringify(tally))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('reconcile: failed', error)
    process.exit(1)
  })
