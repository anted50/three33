import { createServerFn } from '@tanstack/react-start'
import { getRequestIP } from '@tanstack/react-start/server'
import { and, count, eq, gt, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import {
  checkoutAttempts,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
} from '~/db/schema'
import { currentCart } from '../cart/internal'
import { computeTotals } from '../cart/pricing'
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

    const ip = getRequestIP({ xForwardedFor: true }) ?? null

    const record = (
      outcome: 'created' | 'reused' | 'rate_limited' | 'invoice_failed',
      orderId?: string,
    ) =>
      db.insert(checkoutAttempts).values({
        ip,
        phone: data.phone,
        cartId,
        orderId: orderId ?? null,
        outcome,
      })

    await enforceRateLimit(ip, data.phone, record)

    const rates = await loadShippingRates()

    /**
     * Price the cart before anything else, because the fingerprint that decides
     * "same basket?" includes the total. Prices are read under a row lock so
     * two tabs checking out the last unit cannot both be told it is available;
     * the loser waits here and fails the stock check.
     *
     * The lock is released when this transaction commits, before the QPay call.
     * That is fine: nothing is reserved at this stage even in the old code, and
     * settle.ts re-checks stock under its own guard when money actually lands.
     */
    const { pricedLines, totals } = await db.transaction(async (tx) => {
      const variantIds = cart.lines.map((l) => l.variantId)
      const locked = await tx
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
        .where(inArray(productVariants.id, variantIds))
        .for('update', { of: productVariants })

      const byId = new Map(locked.map((v) => [v.id, v]))

      const priced = cart.lines.map((line) => {
        const variant = byId.get(line.variantId)
        if (!variant || !variant.isActive) {
          throw new Error(`${line.productName} борлуулалтад алга`)
        }
        if (variant.stockQty < line.qty) {
          throw new Error(
            `${line.productName}: нөөцөд ${variant.stockQty} ширхэг үлдсэн`,
          )
        }
        return {
          variantId: variant.id,
          // Authoritative price, read under lock.
          unitPrice: variant.price,
          qty: line.qty,
          sku: variant.sku,
          name: variant.size ? `${variant.name} ${variant.size}` : variant.name,
        }
      })

      return { pricedLines: priced, totals: computeTotals(priced, rates) }
    })

    if (!availableProviders().includes(data.method)) {
      throw new Error('Энэ төлбөрийн сонголт одоогоор боломжгүй байна')
    }

    // The drawer greys this out already; this is the check that counts, since
    // it runs against the total recomputed above rather than the browser's.
    if (!meetsMinimum(data.method, totals.total)) {
      const min = PAYMENT_METHOD_MIN_TOTAL[data.method]!
      throw new Error(
        `Энэ төлбөрийн хэлбэрээр ${formatMnt(min)}-с дээш дүнтэй захиалга төлөх боломжтой`,
      )
    }

    const fingerprint = basketFingerprint(pricedLines, totals.total)

    const reused = await reuseLiveCheckout(cartId, fingerprint, data.method)
    if (reused) {
      await record('reused', reused.orderId)
      return reused.result
    }

    const total = totals.total
    const orderNo = generateOrderNo()
    const { token, hash } = mintOrderToken()
    const expiresAt = new Date(Date.now() + INVOICE_TTL_MS)

    /**
     * The invoice comes first. If the provider refuses or times out, the
     * customer sees an error and still has their cart — no order row exists
     * to reconcile, chase or explain.
     */
    const provider = getProvider(data.method)
    let invoice
    try {
      invoice = await provider.createInvoice({
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
    } catch (error) {
      await record('invoice_failed')
      throw error
    }

    const invoicePayload = {
      qrText: invoice.qrText,
      qrImage: invoice.qrImage,
      shortUrl: invoice.shortUrl,
      links: invoice.links,
    }

    let orderId: string
    try {
      orderId = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(orders)
          .values({
            orderNo,
            cartId,
            status: 'pending_payment',
            subtotal: totals.subtotal,
            shippingFee: totals.shippingFee,
            total,
            contactPhone: data.phone,
            note: null,
            expiresAt,
            accessTokenHash: hash,
            shippingAddressSnapshot: {
              name: null,
              phone: data.phone,
              email: data.email || null,
              address: data.address,
            },
          })
          .returning({ id: orders.id })

        if (!created) throw new Error('Захиалга үүсгэж чадсангүй')

        await tx.insert(orderItems).values(
          pricedLines.map((line) => ({
            orderId: created.id,
            variantId: line.variantId,
            skuSnapshot: line.sku,
            nameSnapshot: line.name,
            unitPrice: line.unitPrice,
            qty: line.qty,
          })),
        )

        await tx.insert(payments).values({
          orderId: created.id,
          provider: data.method,
          invoiceId: invoice.invoiceId,
          amount: total,
          status: 'pending',
          /**
           * The QR text, base64 QR image and bank deeplinks as returned at
           * invoice creation. Stored so reloading the payment page re-renders
           * instantly instead of calling the provider again on every refresh.
           */
          invoicePayload,
        })

        return created.id
      })
    } catch (error) {
      /**
       * An invoice now exists at the provider for an order that does not
       * exist here — the mirror image of the old failure, and the easier
       * one: cancel it and nothing is left behind on either side. The
       * likeliest cause is an order_no collision, which the unique index
       * catches.
       */
      try {
        await provider.cancelInvoice(invoice.invoiceId)
      } catch (cancelError) {
        console.error(
          `Orphaned ${data.method} invoice ${invoice.invoiceId} for ${orderNo}`,
          cancelError,
        )
      }
      throw error
    }

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
      ...invoicePayload,
      total,
      expiresAt: expiresAt.getTime(),
      token,
    }
  })

/**
 * Refuses a checkout that is arriving too fast, and records the refusal — the
 * counter has to move on rejected attempts too, or holding at the limit would
 * cost nothing.
 */
async function enforceRateLimit(
  ip: string | null,
  phone: string,
  record: (outcome: 'rate_limited') => Promise<unknown>,
): Promise<void> {
  const since = new Date(Date.now() - RATE_WINDOW_MS)

  const countSince = async (where: ReturnType<typeof and>) => {
    const [row] = await db
      .select({ n: count() })
      .from(checkoutAttempts)
      .where(where)
    return row?.n ?? 0
  }

  const [byPhone, byIp] = await Promise.all([
    countSince(
      and(
        eq(checkoutAttempts.phone, phone),
        gt(checkoutAttempts.createdAt, since),
      ),
    ),
    ip
      ? countSince(
          and(eq(checkoutAttempts.ip, ip), gt(checkoutAttempts.createdAt, since)),
        )
      : Promise.resolve(null),
  ])

  const decision = decideRateLimit({ byIp, byPhone })
  if (decision.allowed) return

  await record('rate_limited')
  throw new Error(
    'Хэт олон захиалга үүсгэлээ. Түр хүлээгээд дахин оролдоно уу.',
  )
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
    .where(
      and(
        eq(orders.cartId, cartId),
        eq(orders.status, 'pending_payment'),
        gt(orders.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!live?.invoiceId || !live.payload) return null

  if (live.provider !== method) {
    await expireCheckout(live.id, 'cancelled')
    return null
  }

  const lines = await db
    .select({ variantId: orderItems.variantId, qty: orderItems.qty })
    .from(orderItems)
    .where(eq(orderItems.orderId, live.id))

  const existing = basketFingerprint(
    lines.map((l) => ({ variantId: l.variantId ?? '', qty: l.qty })),
    live.total,
  )

  if (!sameBasket(existing, fingerprint)) {
    await expireCheckout(live.id, 'cancelled')
    return null
  }

  /**
   * Rotate the token rather than trying to recover the old one — only its hash
   * was ever stored. The customer is being handed a fresh link either way, and
   * a link from a previous visit going dead is the correct outcome.
   */
  const { token, hash } = mintOrderToken()
  await db
    .update(orders)
    .set({ accessTokenHash: hash })
    .where(eq(orders.id, live.id))

  setCheckoutCookie(live.orderNo, token)

  return {
    orderId: live.id,
    result: {
      orderNo: live.orderNo,
      provider: live.provider as ProviderName,
      invoiceId: live.invoiceId,
      ...live.payload,
      total: live.total,
      expiresAt: live.expiresAt.getTime(),
      token,
    },
  }
}
