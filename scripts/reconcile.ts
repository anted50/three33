/**
 * QPay reconciliation sweep. Runs on host cron, hourly — NOT as a server
 * function, because server functions only execute when a request arrives and
 * the entire purpose of this script is to catch orders where no request ever
 * came (dropped callback, customer closed the tab, QPay retry exhausted).
 *
 * Contract: idempotent and safe to run concurrently with a live callback. Both
 * paths insert into `payments`, and `payments_qpay_payment_id_key` makes the
 * loser fail rather than double-credit.
 *
 * Status: the order selection below is complete and correct. Settlement is
 * wired in Phase 4 alongside the QPay provider client — until then this reports
 * what it *would* act on, which is useful for confirming the cron itself works.
 */
import { and, eq, lt } from 'drizzle-orm'
import { db } from '~/db'
import { orders } from '~/db/schema'

/** Grace period: an invoice younger than this may simply still be in progress. */
const STALE_AFTER_MS = 10 * 60 * 1000

async function main() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS)

  const stale = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      total: orders.total,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(eq(orders.status, 'pending_payment'), lt(orders.createdAt, cutoff)),
    )
    // Uses orders_status_created_at_idx.
    .limit(500)

  if (stale.length === 0) {
    console.log('reconcile: nothing pending')
    return
  }

  console.log(`reconcile: ${stale.length} stale pending order(s)`)
  for (const order of stale) {
    // Phase 4: POST /v2/payment/check with { object_type: 'INVOICE',
    // object_id: <qpay_invoice_id> }, then settle inside a transaction that
    // also decrements stock and writes inventory_ledger — or mark `expired`.
    console.log(`  ${order.orderNo} pending since ${order.createdAt.toISOString()}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('reconcile: failed', error)
    process.exit(1)
  })
