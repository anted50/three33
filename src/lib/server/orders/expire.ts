import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { orders, payments, type OrderStatus } from '~/db/schema'
import { atomic } from '~/db/atomic'
import { isGuardFailure } from '../api/db-errors'
import { getProvider } from '../payments/registry'
import { ALREADY_SETTLED, orderStillPending } from './settle'
import { assertTransition } from './state'

/**
 * What expireCheckout did:
 *
 *   retired        the invoice is cancelled and the order is out of pending
 *   not_pending    nothing to do: the order was already settled or retired
 *   cancel_failed  the provider would not cancel the invoice, so the order
 *                  is still pending (see expireCheckout for why)
 */
export type ExpireOutcome = 'retired' | 'not_pending' | 'cancel_failed'

/**
 * Retires a pending checkout: cancels the invoice with its provider, then moves
 * the order out of pending_payment.
 *
 * Cancelling with the provider is the part that matters. Marking an order
 * `expired` on our side does nothing to the invoice — it stays payable, so a
 * customer could pay it days later, and settleOrder would then refuse it
 * (`already_settled`, because the status is no longer pending_payment). Real
 * money would land in the merchant account against an order nobody would ever
 * ship.
 *
 * So when the provider refuses or fails to cancel, the order stays pending.
 * Two reasons it can fail, and pending is right for both:
 *
 *   the invoice was already paid   settleOrder sees a pending order on its
 *                                  next pass and pays it out properly
 *   a timeout, the provider down   the hourly sweep checks for payment and
 *                                  tries the cancel again (reconcile.ts)
 *
 * Three callers share this — the reconciliation sweep, an admin cancelling by
 * hand, and checkout re-issuing an invoice for a changed basket — so that they
 * cannot drift apart on the half that matters.
 */
export async function expireCheckout(
  orderId: string,
  to: 'expired' | 'cancelled',
): Promise<ExpireOutcome> {
  if ((await readOrderStatus(orderId)) !== 'pending_payment') return 'not_pending'

  const payment = await readPayment(orderId)
  if (payment?.invoiceId) {
    const cancelled = await cancelInvoice(payment.provider, payment.invoiceId)
    if (!cancelled) return 'cancel_failed'
  }

  const retired = await retireOrder(orderId, to)
  if (retired) return 'retired'
  return 'not_pending'
}

/**
 * Moves a pending order to `to` without asking the provider anything.
 *
 * expireCheckout calls this once the invoice is cancelled. The sweep also
 * calls it directly, but only as a last resort, after a day of failed cancels
 * (see reconcile.ts). Returns false when the order is no longer pending.
 */
export async function retireOrder(orderId: string, to: 'expired' | 'cancelled'): Promise<boolean> {
  // Re-checked here, and again as the batch's first statement: a settlement
  // may have won the race while we were talking to the provider, in which
  // case the order is paid and must stay so.
  const current = await readOrderStatus(orderId)
  if (current !== 'pending_payment') return false

  assertTransition(current, to)
  const payment = await readPayment(orderId)

  try {
    await atomic([
      orderStillPending(orderId),
      db.update(orders).set({ status: to }).where(eq(orders.id, orderId)),
      payment && db.update(payments).set({ status: 'expired' }).where(eq(payments.id, payment.id)),
    ])
  } catch (error) {
    if (isGuardFailure(error, ALREADY_SETTLED)) return false
    throw error
  }

  return true
}

/** The order's status, or null when there is no such order. */
async function readOrderStatus(orderId: string): Promise<OrderStatus | null> {
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  return order?.status ?? null
}

/** The order's payment row, or undefined when it never got one. */
async function readPayment(orderId: string) {
  const [payment] = await db
    .select({
      id: payments.id,
      provider: payments.provider,
      invoiceId: payments.invoiceId,
    })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1)
  return payment
}

/** Asks the provider to cancel the invoice. False when it would not. */
async function cancelInvoice(provider: string, invoiceId: string): Promise<boolean> {
  try {
    await getProvider(provider).cancelInvoice(invoiceId)
    return true
  } catch (error) {
    console.error(`Could not cancel ${provider} invoice ${invoiceId}; the order stays pending`, error)
    return false
  }
}
