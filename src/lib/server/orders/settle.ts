import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, exists, guard, type Statement } from '~/db/atomic'
import {
  cartItems,
  inventoryLedger,
  orderItems,
  orders,
  payments,
  productVariants,
} from '~/db/schema'
import { isGuardFailure } from '../api/db-errors'
import { inBackground } from '../background'
import { getProvider } from '../payments/registry'
import { sendOrderReceipt } from './receipt'
import { assertTransition } from './state'

export type SettleOutcome =
  | 'settled'
  | 'already_settled'
  | 'unpaid'
  | 'underpaid'
  | 'not_found'
  /** Asked too recently; the answer would not have changed. */
  | 'throttled'

/**
 * Floor on how often one invoice may cost a QPay /payment/check.
 *
 * The payment page polls, so without this every watching customer turns into a
 * steady stream of calls to a provider whose own guidance is to be sparing with
 * their endpoints — and anyone hitting the endpoint deliberately turns into an
 * unbounded one. Set just under the page's fastest poll so a real customer
 * never notices it.
 */
export const MIN_CHECK_INTERVAL_MS = 2_500

/**
 * Asks the order's payment provider whether it is paid and, if so, settles it:
 * flips the status, decrements stock, and writes the inventory ledger — all in
 * one atomic D1 batch.
 *
 * This is the ONLY function that marks an order paid. Every provider's
 * callback route and the reconciliation sweep all come through here, which is
 * what makes them safe to race: they cannot each apply the payment because
 * payments_payment_id_key lets exactly one of them insert.
 *
 * Never trusts the callback body. Settlement always comes from asking the
 * provider directly (checkInvoice).
 */
export async function settleOrder(orderNo: string): Promise<SettleOutcome> {
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
      cartId: orders.cartId,
    })
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!order) return 'not_found'
  if (order.status !== 'pending_payment') return 'already_settled'

  const [payment] = await db
    .select({
      id: payments.id,
      provider: payments.provider,
      invoiceId: payments.invoiceId,
      lastCheckedAt: payments.lastCheckedAt,
    })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1)

  if (!payment?.invoiceId) return 'not_found'

  if (
    payment.lastCheckedAt &&
    Date.now() - payment.lastCheckedAt.getTime() < MIN_CHECK_INTERVAL_MS
  ) {
    return 'throttled'
  }

  // Stamped before the call, not after: two concurrent pollers must not both
  // get past the check above while the first is still waiting on QPay.
  await db
    .update(payments)
    .set({ lastCheckedAt: new Date() })
    .where(eq(payments.id, payment.id))

  const result = await getProvider(payment.provider).checkInvoice(
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

  // Checked here for the clear answer; re-checked by the batch's guard,
  // because a concurrent settle may win between this read and the write.
  assertTransition(order.status, 'paid')

  try {
    await atomic([
      orderStillPending(order.id),
      ...(await markPaid(order, payment.id, {
        paymentId: result.providerPaymentId,
        rawCallback: result.raw,
      })),
    ])
  } catch (error) {
    if (isGuardFailure(error, ALREADY_SETTLED)) return 'already_settled'
    throw error
  }

  /**
   * Not awaited into the response: settlement itself already committed, and
   * whoever called settleOrder (the QPay callback, or a customer's browser
   * polling the payment page) is waiting on this call to return. Sending mail
   * is a background side effect of a payment that already happened, not a
   * step it should wait through.
   */
  inBackground(`receipt ${orderNo}`, sendOrderReceipt(orderNo))

  return 'settled'
}

/** The guard code for "this order is no longer pending_payment". */
export const ALREADY_SETTLED = 'ALREADY_SETTLED'

/**
 * Batch guard: the order is still pending_payment. Goes first in any batch
 * built from markPaid — it is what used to be the row lock.
 */
export function orderStillPending(orderId: string): Statement {
  return guard(
    exists(
      db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending_payment'))),
    ),
    ALREADY_SETTLED,
  )
}

/**
 * The paid half of settlement: flips the payment and the order, decrements
 * stock, writes the inventory ledger and clears the bought lines from the cart.
 *
 * Returns the statements rather than running them: the caller puts them in
 * one batch behind orderStillPending(), which is what makes it safe to race.
 * settleOrder gets here once the provider confirms; a manually recorded admin
 * sale (card reader, cash) gets here directly, the money having been taken at
 * the counter.
 */
export async function markPaid(
  order: { id: string; cartId: string | null },
  paymentRowId: string,
  settlement: { paymentId: string | null; rawCallback: unknown },
  /**
   * The order's lines, when the caller is inserting them in the same batch
   * (a manual admin sale) and they cannot be read yet. Otherwise read here —
   * order lines never change after checkout, so reading them before the batch
   * is safe.
   */
  knownLines?: ReadonlyArray<{ variantId: string | null; qty: number }>,
): Promise<Statement[]> {
  const lines =
    knownLines ??
    (await db
      .select({ variantId: orderItems.variantId, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id)))

  const now = new Date()

  /**
   * The idempotency guard. If a callback and the reconcile sweep both get
   * this far, the second batch trips orderStillPending — or, failing that,
   * payments_payment_id_key — and rolls back, leaving exactly one settlement.
   */
  const statements: Statement[] = [
    db
      .update(payments)
      .set({ status: 'paid', ...settlement, paidAt: now })
      .where(eq(payments.id, paymentRowId)),
  ]

  for (const line of lines) {
    if (!line.variantId) continue

    statements.push(
      // The guard in the WHERE clause means a sale that would oversell
      // updates zero rows rather than going negative...
      db
        .update(productVariants)
        .set({ stockQty: sql`${productVariants.stockQty} - ${line.qty}` })
        .where(
          and(
            eq(productVariants.id, line.variantId),
            sql`${productVariants.stockQty} >= ${line.qty}`,
          ),
        ),
      /**
       * ...and the ledger row reads changes() to record which happened.
       * Paid, but we cannot ship what we do not have: settling anyway and
       * flagging it beats refusing the payment the customer already made, so
       * a short line is recorded as a zero-delta manual adjustment for an
       * admin to resolve.
       */
      db.insert(inventoryLedger).select(sql`
        select
          ${crypto.randomUUID()},
          ${line.variantId},
          case when changes() > 0 then ${-line.qty} else 0 end,
          case when changes() > 0 then 'order_paid' else 'manual_adjustment' end,
          ${order.id},
          null,
          ${now.getTime()}
      `),
    )
  }

  statements.push(
    db.update(orders).set({ status: 'paid' }).where(eq(orders.id, order.id)),
  )

  /**
   * NOW the cart is emptied — not at checkout.
   *
   * Clearing it when the invoice was created is what made an abandoned
   * payment unrecoverable: the customer closed the QR and came back to
   * nothing to retry with. Keeping it until the money lands costs nothing,
   * because one cart can only ever hold one live invoice (see create.ts),
   * so an unchanged basket cannot be paid for twice.
   *
   * Scoped to the variants actually bought, so anything the customer added
   * while the invoice was open survives. Reached through orders.cart_id
   * rather than a cookie, because settlement usually runs from the QPay
   * callback or the sweep, where there is no request to read one from.
   */
  const boughtVariantIds = lines
    .map((line) => line.variantId)
    .filter((id): id is string => id !== null)

  if (order.cartId && boughtVariantIds.length > 0) {
    statements.push(
      db
        .delete(cartItems)
        .where(
          and(
            eq(cartItems.cartId, order.cartId),
            inArray(cartItems.variantId, boughtVariantIds),
          ),
        ),
    )
  }

  return statements
}
