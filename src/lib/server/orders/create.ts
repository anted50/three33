import { createServerFn } from '@tanstack/react-start'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import {
  cartItems,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
} from '~/db/schema'
import { currentCart } from '../cart/internal'
import { computeTotals } from '../cart/pricing'
import { loadShippingRates } from '../settings'
import { buildCallbackUrl } from '../payments/callback-token'
import { getQpayProvider } from '../payments/qpay'
import { env } from '../env'
import { generateOrderNo } from './order-no'

export const checkoutInput = z.object({
  name: z.string().trim().min(1).max(100),
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
  note: z.string().trim().max(1000).optional().or(z.literal('')),
})

export interface CheckoutResult {
  orderNo: string
  invoiceId: string
  qrText: string
  qrImage: string
  shortUrl: string | null
  links: Array<{ name: string; description: string; logo: string; link: string }>
  total: number
}

/**
 * Turns a cart into a pending_payment order and a QPay invoice.
 *
 * The total is recomputed here from product_variants — nothing the browser
 * sent contributes to it. That discipline used to be enforced by a second
 * service revalidating at its boundary; now it is enforced by this function
 * being the only path to an order.
 *
 * Stock is NOT decremented here. An unpaid order must not hold inventory, or
 * an abandoned checkout would take a size off sale for ten minutes. Stock moves
 * when the payment settles — see settle.ts.
 */
export const createOrder = createServerFn({ method: 'POST' })
  .validator(checkoutInput)
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const { cartId, cart } = await currentCart()

    if (cart.lines.length === 0) {
      throw new Error('Таны сагс хоосон байна')
    }

    const rates = await loadShippingRates()

    const { order, total } = await db.transaction(async (tx) => {
      /**
       * Lock the variant rows for the duration. Two customers checking out the
       * last unit at once must not both be told it is available; the loser
       * waits here and then fails the stock check below.
       */
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

      const pricedLines = cart.lines.map((line) => {
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
          name: variant.size
            ? `${variant.name} ${variant.size}`
            : variant.name,
        }
      })

      const totals = computeTotals(pricedLines, rates)

      const [created] = await tx
        .insert(orders)
        .values({
          orderNo: generateOrderNo(),
          status: 'pending_payment',
          subtotal: totals.subtotal,
          shippingFee: totals.shippingFee,
          total: totals.total,
          contactPhone: data.phone,
          note: data.note || null,
          shippingAddressSnapshot: {
            name: data.name,
            phone: data.phone,
            email: data.email || null,
            address: data.address,
          },
        })
        .returning()

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

      // The cart is consumed. If payment fails the customer restarts checkout;
      // leaving it would let them pay twice for the same goods.
      await tx.delete(cartItems).where(eq(cartItems.cartId, cartId))

      return { order: created, total: totals.total }
    })

    /**
     * QPay is called *after* the transaction commits. Holding a database
     * transaction open across a third-party HTTP call would pin the variant
     * locks for the duration of QPay's latency — and worse, a rollback would
     * abandon an invoice that already exists on their side.
     */
    const provider = getQpayProvider()
    const invoice = await provider.createInvoice({
      orderNo: order.orderNo,
      amount: total,
      // Shows on the payer's bank statement, so it names the shop, not a label
      // the shop happens to stock.
      description: `Three33 ${order.orderNo}`,
      callbackUrl: buildCallbackUrl(
        env.APP_URL,
        order.orderNo,
        env.QPAY_CALLBACK_SECRET,
      ),
      customer: {
        name: data.name,
        phone: data.phone,
        email: data.email || undefined,
      },
    })

    await db.insert(payments).values({
      orderId: order.id,
      provider: 'qpay',
      qpayInvoiceId: invoice.invoiceId,
      amount: total,
      status: 'pending',
      invoicePayload: {
        qrText: invoice.qrText,
        qrImage: invoice.qrImage,
        shortUrl: invoice.shortUrl,
        links: invoice.links,
      },
    })

    return {
      orderNo: order.orderNo,
      invoiceId: invoice.invoiceId,
      qrText: invoice.qrText,
      qrImage: invoice.qrImage,
      shortUrl: invoice.shortUrl,
      links: invoice.links,
      total,
    }
  })

