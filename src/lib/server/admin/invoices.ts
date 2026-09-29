import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import {
  adminInvoices,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  users,
} from '~/db/schema'
import { formatMnt } from '~/lib/money'
import { meetsMinimum, PAYMENT_METHOD_MIN_TOTAL } from '~/lib/payment-methods'
import { mintOrderToken } from '../orders/access'
import { expireCheckout } from '../orders/expire'
import { generateOrderNo } from '../orders/order-no'
import { settleOrder } from '../orders/settle'
import {
  availableProviders,
  getProvider,
  providerCallbackUrl,
} from '../payments/registry'
import { invoiceTotal, type CreateAdminInvoiceInput } from './invoice-lines'

/**
 * Admin-issued invoices. Server-only — routes reach this through admin.ts.
 *
 * An admin invoice is an ordinary order with no cart behind it, marked by an
 * admin_invoices row. That is the whole trick: the QPay/StorePay callbacks,
 * the reconcile sweep, expiry, the receipt email and — the part that matters
 * most — stock deduction on payment all come from the existing order pipeline
 * (settle.ts) rather than a second copy of it. Custom lines are order items
 * with no variant, which settlement already skips for stock.
 */

/** Only what the ledger needs; the provider side knows nothing of this. */
const CUSTOM_SKU = 'CUSTOM'

/**
 * Much shorter than checkout's two hours: an admin invoice is issued to a
 * customer standing at the counter, who pays now or not at all.
 */
export const ADMIN_INVOICE_TTL_MS = 15 * 60 * 1000

export async function issueAdminInvoice(
  input: CreateAdminInvoiceInput,
  adminId: string,
): Promise<{ orderNo: string }> {
  if (!availableProviders().includes(input.method)) {
    throw new Error('Энэ төлбөрийн хэлбэр одоогоор боломжгүй байна')
  }

  const phone = input.phone || null
  const email = input.email || null
  const name = input.name || null

  /**
   * Catalog lines are checked against stock now, under a row lock, so the
   * admin hears "only 2 left" before a customer is asked to pay. Nothing is
   * reserved — as with web checkout, stock moves when the money lands, and
   * settle.ts re-checks it then.
   */
  const variantLines = input.lines.flatMap((line) =>
    line.kind === 'variant' ? [line] : [],
  )

  const snapshots = await db.transaction(async (tx) => {
    if (variantLines.length === 0) return new Map<string, { sku: string; name: string }>()

    const locked = await tx
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        size: productVariants.size,
        stockQty: productVariants.stockQty,
        name: products.nameMn,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantLines.map((l) => l.variantId)))
      .for('update', { of: productVariants })

    const byId = new Map(locked.map((v) => [v.id, v]))

    return new Map(
      variantLines.map((line) => {
        const variant = byId.get(line.variantId)
        if (!variant) throw new Error('Бараа олдсонгүй — хуудсаа шинэчилнэ үү')
        const label = variant.size ? `${variant.name} ${variant.size}` : variant.name
        if (variant.stockQty < line.qty) {
          throw new Error(`${label}: нөөцөд ${variant.stockQty} ширхэг үлдсэн`)
        }
        return [line.variantId, { sku: variant.sku, name: label }]
      }),
    )
  })

  const total = invoiceTotal(input.lines)
  if (total <= 0) throw new Error('Нийт дүн 0-ээс их байх ёстой')

  if (!meetsMinimum(input.method, total)) {
    const min = PAYMENT_METHOD_MIN_TOTAL[input.method]!
    throw new Error(
      `Энэ төлбөрийн хэлбэрээр ${formatMnt(min)}-с дээш дүнтэй нэхэмжлэх үүсгэх боломжтой`,
    )
  }

  const orderNo = generateOrderNo()
  // The token guards the customer-facing payment page; admins don't need it,
  // so only its hash is kept — same as any order.
  const { hash } = mintOrderToken()
  const expiresAt = new Date(Date.now() + ADMIN_INVOICE_TTL_MS)

  // Provider first, rows second — same ordering and reasoning as createOrder.
  const provider = getProvider(input.method)
  const invoice = await provider.createInvoice({
    orderNo,
    amount: total,
    description: `Three33 ${orderNo}`,
    callbackUrl: providerCallbackUrl(input.method, orderNo),
    customer:
      phone || email || name
        ? {
            // QPay wants a payer name whenever receiver data is sent.
            name: name ?? phone ?? 'Three33',
            phone: phone ?? undefined,
            email: email ?? undefined,
          }
        : undefined,
  })

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(orders)
        .values({
          orderNo,
          cartId: null,
          status: 'pending_payment',
          subtotal: total,
          shippingFee: 0,
          total,
          contactPhone: phone ?? '',
          note: input.note || null,
          expiresAt,
          accessTokenHash: hash,
          shippingAddressSnapshot: { name, phone: phone ?? '', email },
        })
        .returning({ id: orders.id })

      if (!created) throw new Error('Нэхэмжлэх үүсгэж чадсангүй')

      await tx.insert(orderItems).values(
        input.lines.map((line) => {
          if (line.kind === 'variant') {
            const snap = snapshots.get(line.variantId)!
            return {
              orderId: created.id,
              variantId: line.variantId,
              skuSnapshot: snap.sku,
              nameSnapshot: snap.name,
              unitPrice: line.unitPrice,
              qty: line.qty,
            }
          }
          return {
            orderId: created.id,
            variantId: null,
            skuSnapshot: CUSTOM_SKU,
            nameSnapshot: line.name,
            unitPrice: line.unitPrice,
            qty: line.qty,
          }
        }),
      )

      await tx.insert(payments).values({
        orderId: created.id,
        provider: input.method,
        invoiceId: invoice.invoiceId,
        amount: total,
        status: 'pending',
        invoicePayload: {
          qrText: invoice.qrText,
          qrImage: invoice.qrImage,
          shortUrl: invoice.shortUrl,
          links: invoice.links,
        },
      })

      await tx.insert(adminInvoices).values({
        orderId: created.id,
        createdBy: adminId,
      })
    })
  } catch (error) {
    // A live invoice with no order behind it: cancel it so nobody can pay it.
    try {
      await provider.cancelInvoice(invoice.invoiceId)
    } catch (cancelError) {
      console.error(
        `Orphaned ${input.method} admin invoice ${invoice.invoiceId} for ${orderNo}`,
        cancelError,
      )
    }
    throw error
  }

  return { orderNo }
}

export async function listAdminInvoices() {
  return db
    .select({
      orderNo: orders.orderNo,
      status: orders.status,
      total: orders.total,
      phone: orders.contactPhone,
      provider: payments.provider,
      createdAt: adminInvoices.createdAt,
      createdBy: users.name,
    })
    .from(adminInvoices)
    .innerJoin(orders, eq(orders.id, adminInvoices.orderId))
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .leftJoin(users, eq(users.id, adminInvoices.createdBy))
    .orderBy(desc(adminInvoices.createdAt))
    .limit(50)
}

/**
 * Everything the invoice screen shows. While unpaid it asks the provider
 * first — the same thing the customer's payment page does — so the admin
 * standing at the counter sees "paid" without waiting for the callback.
 * settleOrder throttles how often that actually reaches the provider.
 */
export async function adminInvoiceDetail(orderNo: string) {
  const [head] = await db
    .select({ id: orders.id, status: orders.status, expiresAt: orders.expiresAt })
    .from(orders)
    .innerJoin(adminInvoices, eq(adminInvoices.orderId, orders.id))
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!head) return null

  if (head.status === 'pending_payment') {
    try {
      const outcome = await settleOrder(orderNo)

      /**
       * Retire it the moment its window closes rather than waiting for the
       * hourly sweep — with a 15-minute window that wait would be most of an
       * hour in which a "lapsed" invoice could still be paid. Only when the
       * provider has just said it's unpaid; money that arrived still settles.
       */
      if (outcome === 'unpaid' && head.expiresAt.getTime() <= Date.now()) {
        await expireCheckout(head.id, 'expired')
      }
    } catch (error) {
      // Showing the invoice matters more than refreshing it; the next poll,
      // the callback or the sweep will try again.
      console.error(`admin invoice ${orderNo}: status check failed`, error)
    }
  }

  const [order] = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      total: orders.total,
      note: orders.note,
      address: orders.shippingAddressSnapshot,
      expiresAt: orders.expiresAt,
      createdAt: orders.createdAt,
      createdBy: users.name,
    })
    .from(orders)
    .innerJoin(adminInvoices, eq(adminInvoices.orderId, orders.id))
    .leftJoin(users, eq(users.id, adminInvoices.createdBy))
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!order) return null

  const items = await db
    .select({
      name: orderItems.nameSnapshot,
      sku: orderItems.skuSnapshot,
      unitPrice: orderItems.unitPrice,
      qty: orderItems.qty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id))

  const [payment] = await db
    .select({
      provider: payments.provider,
      status: payments.status,
      payload: payments.invoicePayload,
      paidAt: payments.paidAt,
    })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1)

  const { id: _id, ...rest } = order
  return {
    ...rest,
    expiresAt: order.expiresAt.getTime(),
    items,
    payment: payment ?? null,
  }
}
