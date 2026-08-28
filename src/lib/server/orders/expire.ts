import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { orders, payments } from '~/db/schema'
import { getQpayProvider } from '../payments/qpay'
import { assertTransition } from './state'

/**
 * Retires a pending checkout: cancels the invoice at QPay, then moves the order
 * out of pending_payment.
 *
 * Cancelling at QPay is the part that used to be missing. Marking an order
 * `expired` on our side does nothing to the invoice — it stays payable, so a
 * customer could pay it days later, and settleOrder would then refuse it
 * (`already_settled`, because the status is no longer pending_payment). Real
 * money would land in the merchant account against an order nobody would ever
 * ship. The only way to close that window is to tell QPay the invoice is dead.
 *
 * Three callers share this — the reconciliation sweep, an admin cancelling by
 * hand, and checkout re-issuing an invoice for a changed basket — so that they
 * cannot drift apart on the half that matters.
 */
export async function expireCheckout(
  orderId: string,
  to: 'expired' | 'cancelled',
): Promise<boolean> {
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!order || order.status !== 'pending_payment') return false

  const [payment] = await db
    .select({ id: payments.id, invoiceId: payments.qpayInvoiceId })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1)

  if (payment?.invoiceId) {
    try {
      await getQpayProvider().cancelInvoice(payment.invoiceId)
    } catch (error) {
      /**
       * Not fatal, and deliberately not a reason to leave the order pending.
       * QPay rejects the cancellation of an invoice that has already been paid,
       * which is exactly the case we must not strand: settleOrder still sees a
       * pending order on its next pass and pays it out properly. Any other
       * failure is a dead invoice we could not reach, which the sweep will
       * retry.
       */
      console.error(`Could not cancel QPay invoice ${payment.invoiceId}`, error)
    }
  }

  return db.transaction(async (tx) => {
    // Re-read under the transaction: a settlement may have won the race while
    // we were talking to QPay, in which case the order is paid and must stay so.
    const [current] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
      .limit(1)

    if (!current || current.status !== 'pending_payment') return false

    assertTransition(current.status, to)

    await tx.update(orders).set({ status: to }).where(eq(orders.id, orderId))

    if (payment) {
      await tx
        .update(payments)
        .set({ status: 'expired' })
        .where(eq(payments.id, payment.id))
    }

    return true
  })
}
