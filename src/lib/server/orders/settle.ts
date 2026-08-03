import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import {
  inventoryLedger,
  orderItems,
  orders,
  payments,
  productVariants,
} from '~/db/schema'
import { getQpayProvider } from '../payments/qpay'
import { assertTransition } from './state'

export type SettleOutcome =
  | 'settled'
  | 'already_settled'
  | 'unpaid'
  | 'underpaid'
  | 'not_found'

/**
 * Asks QPay whether an order is paid and, if so, settles it: flips the status,
 * decrements stock, and writes the inventory ledger — all in one transaction.
 *
 * This is the ONLY function that marks an order paid. The callback route and
 * the reconciliation sweep both come through here, which is what makes them
 * safe to race: they cannot each apply the payment because
 * payments_qpay_payment_id_key lets exactly one of them insert.
 *
 * Never trusts the callback body. Settlement always comes from payment/check.
 */
export async function settleOrder(orderNo: string): Promise<SettleOutcome> {
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
    })
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!order) return 'not_found'
  if (order.status !== 'pending_payment') return 'already_settled'

  const [payment] = await db
    .select({ id: payments.id, invoiceId: payments.qpayInvoiceId })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1)

  if (!payment?.invoiceId) return 'not_found'

  const result = await getQpayProvider().checkInvoice(
    payment.invoiceId,
    order.total,
  )

  if (result.outcome === 'unpaid') return 'unpaid'
  if (result.outcome === 'underpaid') {
    // Deliberately not settled and deliberately not cancelled: real money
    // arrived, so this needs a human, not an automatic decision.
    await db
      .update(payments)
      .set({ status: 'pending', rawCallback: result.raw })
      .where(eq(payments.id, payment.id))
    return 'underpaid'
  }
  if (result.outcome === 'refunded') return 'already_settled'

  try {
    await db.transaction(async (tx) => {
      // Re-read under the transaction: a concurrent settle may have won since
      // the status check above.
      const [current] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id))
        .for('update')
        .limit(1)

      if (!current || current.status !== 'pending_payment') {
        throw new AlreadySettled()
      }

      assertTransition(current.status, 'paid')

      /**
       * The idempotency guard. If a callback and the reconcile sweep both get
       * here, the second insert violates payments_qpay_payment_id_key and this
       * transaction rolls back — leaving exactly one settlement.
       */
      await tx
        .update(payments)
        .set({
          status: 'paid',
          qpayPaymentId: result.providerPaymentId,
          rawCallback: result.raw,
          paidAt: new Date(),
        })
        .where(eq(payments.id, payment.id))

      const lines = await tx
        .select({ variantId: orderItems.variantId, qty: orderItems.qty })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))

      for (const line of lines) {
        if (!line.variantId) continue

        // Lock, then decrement. The guard in the WHERE clause means a race
        // that would oversell updates zero rows rather than going negative.
        const updated = await tx
          .update(productVariants)
          .set({ stockQty: sql`${productVariants.stockQty} - ${line.qty}` })
          .where(
            and(
              eq(productVariants.id, line.variantId),
              sql`${productVariants.stockQty} >= ${line.qty}`,
            ),
          )
          .returning({ id: productVariants.id })

        if (updated.length === 0) {
          /**
           * Paid, but we cannot ship what we do not have. Settling anyway and
           * flagging it beats refusing the payment the customer already made —
           * so the stock movement is recorded as a manual adjustment for an
           * admin to resolve.
           */
          await tx.insert(inventoryLedger).values({
            variantId: line.variantId,
            delta: 0,
            reason: 'manual_adjustment',
            orderId: order.id,
          })
          continue
        }

        await tx.insert(inventoryLedger).values({
          variantId: line.variantId,
          delta: -line.qty,
          reason: 'order_paid',
          orderId: order.id,
        })
      }

      await tx
        .update(orders)
        .set({ status: 'paid' })
        .where(eq(orders.id, order.id))
    })
  } catch (error) {
    if (error instanceof AlreadySettled) return 'already_settled'
    throw error
  }

  return 'settled'
}

class AlreadySettled extends Error {}
