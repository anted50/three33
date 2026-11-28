import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, exists, guard, type Statement } from '~/db/atomic'
import {
  cartItems,
  inventoryLedger,
  orderItems,
  orders,
  payments,
  productVariants,
  type OrderStatus,
} from '~/db/schema'
import { D1_BOUND_PARAMETERS_MAX } from '~/db/limits'
import { assert, assertNever } from '~/lib/assert'
import { isGuardFailure } from '../api/db-errors'
import { inBackground } from '../background'
import type { SettlementResult } from '../payments/provider'
import { getProvider } from '../payments/registry'
import { ORDER_LINES_MAX } from './limits'
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
    .select({ id: orders.id, status: orders.status, total: orders.total, cartId: orders.cartId })
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!order) return 'not_found'
  if (order.status !== 'pending_payment') return 'already_settled'

  const [payment] = await db
    .select({ id: payments.id, provider: payments.provider, invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1)

  if (!payment?.invoiceId) return 'not_found'
  if (!(await claimCheck(payment.id))) return 'throttled'

  const result = await getProvider(payment.provider).checkInvoice(payment.invoiceId, order.total)
  switch (result.outcome) {
    case 'unpaid':
      return 'unpaid'
    case 'refunded':
      return 'already_settled'
    case 'underpaid':
      // Deliberately not settled and deliberately not cancelled: real money
      // arrived, so this needs a human, not an automatic decision.
      await db.update(payments).set({ status: 'pending', rawCallback: result.raw }).where(eq(payments.id, payment.id))
      return 'underpaid'
    case 'paid':
      // Paired with decideSettlement's own `>=`: a provider is never trusted
      // to have compared the amount for us.
      assert(result.paidAmount >= order.total, 'a paid check covers the order total')
      return applyPayment(orderNo, order, payment.id, result)
    default:
      return assertNever(result.outcome, 'unknown settlement outcome')
  }
}

/**
 * Claims the right to ask the provider, at most once per
 * MIN_CHECK_INTERVAL_MS per payment. One conditional UPDATE, so of two
 * concurrent pollers exactly one gets past it; a read-then-stamp would let
 * both through while the first was still waiting on the provider.
 */
async function claimCheck(paymentRowId: string): Promise<boolean> {
  const claimed = await db
    .update(payments)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(payments.id, paymentRowId),
        or(isNull(payments.lastCheckedAt), lt(payments.lastCheckedAt, new Date(Date.now() - MIN_CHECK_INTERVAL_MS))),
      ),
    )
    .returning({ id: payments.id })
  assert(claimed.length <= 1, 'claimCheck updates one payment row at most')
  return claimed.length === 1
}

/** The provider said paid: settle it, unless a concurrent settle got there first. */
async function applyPayment(
  orderNo: string,
  order: { id: string; status: OrderStatus; cartId: string | null },
  paymentRowId: string,
  result: SettlementResult,
): Promise<SettleOutcome> {
  assert(result.outcome === 'paid', 'applyPayment only applies a paid check')
  assert(result.providerPaymentId, 'a paid check carries the provider payment id')
  // Checked here for the clear answer; re-checked by the batch's guard,
  // because a concurrent settle may win between the read and the write.
  assertTransition(order.status, 'paid')

  try {
    await atomic([
      orderStillPending(order.id),
      ...(await markPaid(order, paymentRowId, { paymentId: result.providerPaymentId, rawCallback: result.raw })),
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
  const lines = knownLines ?? (await readOrderLines(order.id))
  assert(lines.length > 0, 'an order has at least one line')
  assert(lines.length <= ORDER_LINES_MAX, 'an order holds at most ORDER_LINES_MAX lines')
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
    // Custom admin-invoice lines have no variant and move no stock.
    if (line.variantId) statements.push(...stockStatements(line.variantId, line.qty, order.id, now))
  }

  statements.push(
    db.update(orders).set({ status: 'paid' }).where(eq(orders.id, order.id)),
  )

  const boughtVariantIds = lines
    .map((line) => line.variantId)
    .filter((id): id is string => id !== null)

  if (order.cartId && boughtVariantIds.length > 0) {
    statements.push(clearBoughtCartLines(order.cartId, boughtVariantIds))
  }

  return statements
}

/** An order's lines, for the stock move. Bounded: see ORDER_LINES_MAX. */
async function readOrderLines(orderId: string): Promise<Array<{ variantId: string | null; qty: number }>> {
  return db
    .select({ variantId: orderItems.variantId, qty: orderItems.qty })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .limit(ORDER_LINES_MAX + 1)
}

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
function clearBoughtCartLines(cartId: string, boughtVariantIds: readonly string[]): Statement {
  assert(boughtVariantIds.length > 0, 'clearing a cart names at least one variant')
  // One parameter per variant plus the cart id. Only checkout orders have a
  // cart, and those are capped at MAX_CART_LINES, well below the limit.
  assert(boughtVariantIds.length + 1 <= D1_BOUND_PARAMETERS_MAX, 'bought variants fit one D1 statement')
  return db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cartId), inArray(cartItems.variantId, [...boughtVariantIds])))
}

/**
 * One paid line's stock move: a decrement that refuses to go negative, and
 * the ledger row recording whether it happened.
 */
function stockStatements(variantId: string, qty: number, orderId: string, now: Date): Statement[] {
  assert(Number.isInteger(qty), 'line quantities are whole units')
  assert(qty > 0, 'line quantities are positive')
  return [
    // The guard in the WHERE clause means a sale that would oversell
    // updates zero rows rather than going negative...
    db
      .update(productVariants)
      .set({ stockQty: sql`${productVariants.stockQty} - ${qty}` })
      .where(and(eq(productVariants.id, variantId), sql`${productVariants.stockQty} >= ${qty}`)),
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
        ${variantId},
        case when changes() > 0 then ${-qty} else 0 end,
        case when changes() > 0 then 'order_paid' else 'manual_adjustment' end,
        ${orderId},
        null,
        ${now.getTime()}
    `),
  ]
}
