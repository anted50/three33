import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { and, count, eq, gt, inArray, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, insertRows } from '~/db/atomic'
import {
  checkoutAttempts,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
} from '~/db/schema'
import { currentCart } from '../cart/internal'
import { clientIp } from '../client-ip'
import { computeTotals, MAX_CART_LINES, type CartTotals, type ShippingRates } from '../cart/pricing'
import type { CartLine } from '../cart/internal'
import type { CreatedInvoice } from '../payments/provider'
import { assert } from '~/lib/assert'
import { loadShippingRates } from '../settings'
import {
  availableProviders,
  getProvider,
  providerCallbackUrl,
  type ProviderName,
} from '../payments/registry'
import { formatMnt } from '~/lib/money'
import { meetsMinimum, PAYMENT_METHOD_MIN_TOTAL } from '~/lib/payment-methods'
import { mintOrderToken, setCheckoutCookie } from './access'
import { basketFingerprint, sameBasket } from './basket'
import { expireCheckout } from './expire'
import { ORDER_LINES_MAX } from './limits'
import { generateOrderNo } from './order-no'
import { decideRateLimit, RATE_WINDOW_MS } from './rate-limit'

/** Which payment methods checkout may currently offer — read by the drawer
 * to decide whether to show a choice at all. */
export const getCheckoutMethods = createServerFn({ method: 'GET' }).handler(
  async () => availableProviders(),
)

export const checkoutInput = z.object({
  phone: z
    .string()
    .trim()
    // Mongolian mobile numbers are 8 digits.
    .regex(/^\d{8}$/, 'Утасны дугаар 8 оронтой байх ёстой'),
  email: z.email().max(255).optional().or(z.literal('')),
  /**
   * One free-text block. The аймаг → сум → хороо selects this replaced were
   * three chances to get stuck on a list that never quite matched where the
   * customer lives; the courier reads the address either way.
   */
  address: z.string().trim().min(5).max(500),
  /** Which payment provider to invoice through. Defaults to the original,
   * always-available option so existing integrations (and tests) that don't
   * send this keep working unchanged. */
  method: z.enum(['qpay', 'storepay']).default('qpay'),
})

type CheckoutInput = z.infer<typeof checkoutInput>

export interface CheckoutResult {
  orderNo: string
  provider: ProviderName
  invoiceId: string
  qrText: string
  qrImage: string
  shortUrl: string | null
  links: Array<{ name: string; description: string; logo: string; link: string }>
  total: number
  /** Epoch ms. The payment page counts down to this. */
  expiresAt: number
  /** Also set as a cookie; returned so a payment link can carry it. */
  token: string
}

/**
 * How long an invoice stays payable, whichever provider issued it.
 *
 * These are payments people finish in minutes — scan a QR, confirm a loan in
 * an app — not bank transfers people sleep on. A short window keeps the gap
 * in which a stale invoice could still take money small, and lets an
 * abandoned checkout be retired while the customer is still plausibly around
 * to be told about it.
 */
export const INVOICE_TTL_MS = 2 * 60 * 60 * 1000

/**
 * Turns a cart into a pending_payment order and an invoice with the chosen
 * payment provider.
 *
 * The total is recomputed here from product_variants — nothing the browser
 * sent contributes to it. That discipline used to be enforced by a second
 * service revalidating at its boundary; now it is enforced by this function
 * being the only path to an order.
 *
 * Stock is NOT decremented here. An unpaid order must not hold inventory, or
 * an abandoned checkout would take a size off sale for two hours. Stock moves
 * when the payment settles — see settle.ts.
 *
 * Two rules shape everything below.
 *
 * ONE LIVE INVOICE PER CART. A refresh, a double-tapped pay button and a
 * back-button resubmission must all arrive at the same invoice, not at three
 * orders and three invoices on the merchant account. This is also what makes it
 * safe to leave the cart intact (see below): an unchanged basket can only ever
 * reach the invoice it already has, so there is nothing to pay for twice.
 *
 * NOTHING IS WRITTEN UNTIL THE PROVIDER ANSWERS. The order rows are inserted
 * after the invoice exists, not before. Written the other way round — as this
 * function used to be — a provider timeout left an order with no payment row,
 * which settleOrder can only ever report as `not_found` and the sweep can
 * never expire: a permanently unpayable order, and an emptied cart to go
 * with it.
 */
export const createOrder = createServerFn({ method: 'POST' })
  .validator(checkoutInput)
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const { cartId, cart } = await currentCart()

    if (cart.lines.length === 0) {
      throw new Error('Таны сагс хоосон байна')
    }
    // addToCart refuses a new line past the cap; this is the paired check.
    assert(cart.lines.length <= MAX_CART_LINES, 'carts never hold more than MAX_CART_LINES lines')

    const ip = clientIp(getRequestHeader)
    const record: RecordAttempt = (outcome, orderId) =>
      db.insert(checkoutAttempts).values({ ip, phone: data.phone, cartId, orderId: orderId ?? null, outcome })

    await enforceRateLimit(ip, data.phone, record)

    // Priced before anything else, because the fingerprint that decides
    // "same basket?" includes the total.
    const { pricedLines, totals } = await priceCart(cart.lines, await loadShippingRates())
    assertMethodAllowed(data.method, totals.total)

    const reused = await reuseLiveCheckout(cartId, basketFingerprint(pricedLines, totals.total), data.method)
    if (reused) {
      await record('reused', reused.orderId)
      return reused.result
    }

    return issueCheckout({ cartId, data, pricedLines, totals, record })
  })

type CheckoutOutcome = 'created' | 'reused' | 'rate_limited' | 'invoice_failed'

/** Writes one checkout_attempts row; the rate limit counts these. */
type RecordAttempt = (outcome: CheckoutOutcome, orderId?: string) => Promise<unknown>

/**
 * A new order and a new invoice, for a cart with no live invoice to reuse.
 * The invoice is requested before any order row is written — see createOrder.
 */
async function issueCheckout(checkout: {
  cartId: string
  data: CheckoutInput
  pricedLines: PricedOrderLine[]
  totals: CartTotals
  record: RecordAttempt
}): Promise<CheckoutResult> {
  const { data, totals, record } = checkout
  const orderNo = generateOrderNo()
  const { token, hash } = mintOrderToken()
  const expiresAt = new Date(Date.now() + INVOICE_TTL_MS)

  /**
   * The invoice comes first. If the provider refuses or times out, the
   * customer sees an error and still has their cart — no order row exists
   * to reconcile, chase or explain.
   */
  let invoice: CreatedInvoice
  try {
    invoice = await requestInvoice(data, orderNo, totals.total)
  } catch (error) {
    await record('invoice_failed')
    throw error
  }

  const orderId = crypto.randomUUID()
  await saveOrder({
    orderId,
    orderNo,
    cartId: checkout.cartId,
    data,
    pricedLines: checkout.pricedLines,
    totals,
    invoice,
    expiresAt,
    accessTokenHash: hash,
  })

  /**
   * The cart is deliberately NOT emptied here. It is what the customer comes
   * back to if they close the tab on the QR, and clearing it before the money
   * arrived is what made an abandoned checkout unrecoverable. It is cleared
   * when the payment settles instead — see settle.ts.
   */
  setCheckoutCookie(orderNo, token)
  await record('created', orderId)

  return {
    orderNo,
    provider: data.method,
    invoiceId: invoice.invoiceId,
    ...invoicePayloadOf(invoice),
    total: totals.total,
    expiresAt: expiresAt.getTime(),
    token,
  }
}

/** Asks the chosen provider for an invoice of `total` mungu. Writes nothing. */
function requestInvoice(data: CheckoutInput, orderNo: string, total: number): Promise<CreatedInvoice> {
  assert(total > 0, 'an invoice is never for nothing')
  return getProvider(data.method).createInvoice({
    orderNo,
    amount: total,
    // Shows on the payer's bank statement / StorePay app, so it names
    // the shop, not a label the shop happens to stock.
    description: `Three33 ${orderNo}`,
    callbackUrl: providerCallbackUrl(data.method, orderNo),
    customer: {
      // No name is collected at checkout; QPay still requires a payer
      // name, so the phone number stands in for it. StorePay ignores it.
      name: data.phone,
      phone: data.phone,
      email: data.email || undefined,
    },
  })
}

interface PricedOrderLine {
  variantId: string
  unitPrice: number
  qty: number
  sku: string
  name: string
}

/**
 * Prices the cart from product_variants — nothing the browser sent
 * contributes to the total.
 *
 * A plain read — D1 has no row locks, and none is needed: nothing is
 * reserved at this stage, so two tabs both being told the last unit is
 * available only means both can be invoiced. settle.ts decides who gets it,
 * with a conditional decrement when money actually lands.
 */
async function priceCart(
  lines: readonly CartLine[],
  rates: ShippingRates,
): Promise<{ pricedLines: PricedOrderLine[]; totals: CartTotals }> {
  const variants = await db
    .select({
      id: productVariants.id,
      price: productVariants.price,
      stockQty: productVariants.stockQty,
      isActive: productVariants.isActive,
      sku: productVariants.sku,
      size: productVariants.size,
      name: products.nameMn,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, lines.map((l) => l.variantId)))

  const byId = new Map(variants.map((v) => [v.id, v]))

  const pricedLines = lines.map((line) => {
    const variant = byId.get(line.variantId)
    if (!variant || !variant.isActive) {
      throw new Error(`${line.productName} борлуулалтад алга`)
    }
    if (variant.stockQty < line.qty) {
      throw new Error(`${line.productName}: нөөцөд ${variant.stockQty} ширхэг үлдсэн`)
    }
    return {
      variantId: variant.id,
      // Authoritative price, from the database, not the browser.
      unitPrice: variant.price,
      qty: line.qty,
      sku: variant.sku,
      name: variant.size ? `${variant.name} ${variant.size}` : variant.name,
    }
  })

  assert(pricedLines.length === lines.length, 'every cart line is priced')
  return { pricedLines, totals: computeTotals(pricedLines, rates) }
}

/**
 * The drawer greys these out already; this is the check that counts, since it
 * runs against the total recomputed on the server rather than the browser's.
 */
function assertMethodAllowed(method: ProviderName, total: number): void {
  if (!availableProviders().includes(method)) {
    throw new Error('Энэ төлбөрийн сонголт одоогоор боломжгүй байна')
  }
  if (!meetsMinimum(method, total)) {
    const min = PAYMENT_METHOD_MIN_TOTAL[method]
    assert(min !== undefined, 'a method with a minimum has it listed')
    throw new Error(`Энэ төлбөрийн хэлбэрээр ${formatMnt(min)}-с дээш дүнтэй захиалга төлөх боломжтой`)
  }
}

/** What the payment page needs to render, stored so a reload costs no API call. */
function invoicePayloadOf(invoice: CreatedInvoice) {
  return { qrText: invoice.qrText, qrImage: invoice.qrImage, shortUrl: invoice.shortUrl, links: invoice.links }
}

/**
 * Writes the order, its lines and its payment in one batch. If that fails, an
 * invoice exists at the provider for an order that does not exist here — the
 * mirror image of the old failure, and the easier one: cancel it and nothing
 * is left behind on either side. The likeliest cause is an order_no
 * collision, which the unique index catches.
 */
async function saveOrder(order: {
  orderId: string
  orderNo: string
  cartId: string
  data: CheckoutInput
  pricedLines: PricedOrderLine[]
  totals: CartTotals
  invoice: CreatedInvoice
  expiresAt: Date
  accessTokenHash: string
}): Promise<void> {
  const { orderId, orderNo, data, totals, invoice } = order
  assert(order.pricedLines.length > 0, 'an order has at least one line')
  assert(totals.total > 0, 'a non-empty cart has a positive total')
  try {
    await atomic([
      db.insert(orders).values({
        id: orderId,
        orderNo,
        cartId: order.cartId,
        status: 'pending_payment',
        subtotal: totals.subtotal,
        shippingFee: totals.shippingFee,
        total: totals.total,
        contactPhone: data.phone,
        note: null,
        expiresAt: order.expiresAt,
        accessTokenHash: order.accessTokenHash,
        shippingAddressSnapshot: { name: null, phone: data.phone, email: data.email || null, address: data.address },
      }),
      ...insertRows(
        orderItems,
        order.pricedLines.map((line) => ({
          orderId,
          variantId: line.variantId,
          skuSnapshot: line.sku,
          nameSnapshot: line.name,
          unitPrice: line.unitPrice,
          qty: line.qty,
        })),
      ),
      db.insert(payments).values({
        orderId,
        provider: data.method,
        invoiceId: invoice.invoiceId,
        amount: totals.total,
        status: 'pending',
        invoicePayload: invoicePayloadOf(invoice),
      }),
    ])
  } catch (error) {
    try {
      await getProvider(data.method).cancelInvoice(invoice.invoiceId)
    } catch (cancelError) {
      console.error(`Orphaned ${data.method} invoice ${invoice.invoiceId} for ${orderNo}`, cancelError)
    }
    throw error
  }
}

/**
 * Refuses a checkout that is arriving too fast, and records the refusal — the
 * counter has to move on rejected attempts too, or holding at the limit would
 * cost nothing.
 */
async function enforceRateLimit(ip: string | null, phone: string, record: RecordAttempt): Promise<void> {
  const since = new Date(Date.now() - RATE_WINDOW_MS)

  const [byPhone, byIp] = await Promise.all([
    countAttemptsSince(eq(checkoutAttempts.phone, phone), since),
    // No address (the proxy stripped it) means no IP limit; the phone one still applies.
    ip ? countAttemptsSince(eq(checkoutAttempts.ip, ip), since) : Promise.resolve(null),
  ])

  const decision = decideRateLimit({ byIp, byPhone })
  if (decision.allowed) return

  await record('rate_limited')
  throw new Error('Хэт олон захиалга үүсгэлээ. Түр хүлээгээд дахин оролдоно уу.')
}

/** Checkout attempts matching `key` recorded after `since`. */
async function countAttemptsSince(key: SQL, since: Date): Promise<number> {
  const [row] = await db
    .select({ attempts: count() })
    .from(checkoutAttempts)
    .where(and(key, gt(checkoutAttempts.createdAt, since)))
  const attempts = row?.attempts ?? 0
  assert(Number.isInteger(attempts), 'count() is a whole number')
  assert(attempts >= 0, 'count() is never negative')
  return attempts
}

/**
 * Retires the cart's old checkout before a new invoice is issued. When its
 * invoice cannot be cancelled, checkout stops here: issuing a second invoice
 * would leave two payable for one cart. The old order stays pending, and the
 * customer's retry tries the cancel again.
 */
async function retireLiveCheckout(orderId: string): Promise<void> {
  const result = await expireCheckout(orderId, 'cancelled')
  if (result === 'cancel_failed') {
    throw new Error('Өмнөх нэхэмжлэхийг цуцалж чадсангүй. Түр хүлээгээд дахин оролдоно уу.')
  }
}

/**
 * The live invoice for this cart, if the basket has not changed since it was
 * issued and it was issued against the same payment method being requested
 * now.
 *
 * A changed basket — or a changed payment method — retires the old invoice
 * rather than leaving it payable alongside the new one: two live invoices for
 * one cart is how a customer pays the wrong amount, or pays the right amount
 * twice through two different providers.
 */
async function reuseLiveCheckout(
  cartId: string,
  fingerprint: string,
  method: ProviderName,
): Promise<{ orderId: string; result: CheckoutResult } | null> {
  const live = await findLiveCheckout(cartId)
  if (live === null) return null

  if (live.provider !== method) {
    await retireLiveCheckout(live.id)
    return null
  }

  if (!sameBasket(await liveBasketFingerprint(live.id, live.total), fingerprint)) {
    await retireLiveCheckout(live.id)
    return null
  }

  /**
   * Rotate the token rather than trying to recover the old one — only its hash
   * was ever stored. The customer is being handed a fresh link either way, and
   * a link from a previous visit going dead is the correct outcome.
   */
  const { token, hash } = mintOrderToken()
  await db.update(orders).set({ accessTokenHash: hash }).where(eq(orders.id, live.id))
  setCheckoutCookie(live.orderNo, token)

  return {
    orderId: live.id,
    result: {
      orderNo: live.orderNo,
      provider: method,
      invoiceId: live.invoiceId,
      qrText: live.payload.qrText,
      qrImage: live.payload.qrImage,
      shortUrl: live.payload.shortUrl,
      links: live.payload.links,
      total: live.total,
      expiresAt: live.expiresAt.getTime(),
      token,
    },
  }
}

/** This cart's unexpired pending order and its invoice, if it has one that can be shown again. */
async function findLiveCheckout(cartId: string) {
  const [live] = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      provider: payments.provider,
      total: orders.total,
      expiresAt: orders.expiresAt,
      invoiceId: payments.invoiceId,
      payload: payments.invoicePayload,
    })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.cartId, cartId), eq(orders.status, 'pending_payment'), gt(orders.expiresAt, new Date())))
    .limit(1)

  if (!live?.invoiceId || !live.payload) return null
  return { ...live, invoiceId: live.invoiceId, payload: live.payload }
}

/** The fingerprint of what a pending order froze, to compare with the cart now. */
async function liveBasketFingerprint(orderId: string, total: number): Promise<string> {
  const lines = await db
    .select({ variantId: orderItems.variantId, qty: orderItems.qty })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .limit(ORDER_LINES_MAX + 1)
  assert(lines.length > 0, 'an order has at least one line')
  assert(lines.length <= ORDER_LINES_MAX, 'an order holds at most ORDER_LINES_MAX lines')

  // A line whose variant was since deleted fingerprints as '', which no cart
  // line matches: the basket is different, and the old invoice is retired.
  return basketFingerprint(
    lines.map((line) => ({ variantId: line.variantId ?? '', qty: line.qty })),
    total,
  )
}
