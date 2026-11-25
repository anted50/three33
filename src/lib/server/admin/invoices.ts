import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, insertRows } from '~/db/atomic'
import { assert } from '~/lib/assert'
import type { CreatedInvoice, PaymentProvider } from '../payments/provider'
import { inBackground } from '../background'
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
import { sendOrderReceipt } from '../orders/receipt'
import { markPaid, settleOrder } from '../orders/settle'
import {
  availableProviders,
  getProvider,
  providerCallbackUrl,
} from '../payments/registry'
import { invoiceTotal, type CreateAdminInvoiceInput, type InvoiceLineInput } from './invoice-lines'

/**
 * Admin-issued invoices. Server-only — routes reach this through admin.ts.
 *
 * An admin invoice is an ordinary order with no cart behind it, marked by an
 * admin_invoices row. That is the whole trick: the QPay/StorePay callbacks,
 * the reconcile sweep, expiry, the receipt email and — the part that matters
 * most — stock deduction on payment all come from the existing order pipeline
 * (settle.ts) rather than a second copy of it. Custom lines are order items
 * with no variant, which settlement already skips for stock.
 *
 * A `manual` invoice (card reader, cash) skips the provider entirely and is
 * written already paid, through the same markPaid that settleOrder uses.
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
  /** Null for a manual sale: there's no provider to invoice or ask. */
  const providerName = input.method === 'manual' ? null : input.method
  if (providerName && !availableProviders().includes(providerName)) {
    throw new Error('Энэ төлбөрийн хэлбэр одоогоор боломжгүй байна')
  }

  const snapshots = await variantSnapshots(input.lines)
  const total = invoiceTotal(input.lines)
  if (total <= 0) throw new Error('Нийт дүн 0-ээс их байх ёстой')
  if (!meetsMinimum(input.method, total)) {
    const min = PAYMENT_METHOD_MIN_TOTAL[input.method]
    assert(min !== undefined, 'a method with a minimum has it listed')
    throw new Error(`Энэ төлбөрийн хэлбэрээр ${formatMnt(min)}-с дээш дүнтэй нэхэмжлэх үүсгэх боломжтой`)
  }

  const orderNo = generateOrderNo()
  const customer = { phone: input.phone || null, email: input.email || null, name: input.name || null }

  // Provider first, rows second — same ordering and reasoning as createOrder.
  const provider = providerName ? getProvider(providerName) : null
  const invoice = provider && providerName
    ? await provider.createInvoice({
        orderNo,
        amount: total,
        description: `Three33 ${orderNo}`,
        callbackUrl: providerCallbackUrl(providerName, orderNo),
        customer: customer.phone || customer.email || customer.name
          ? {
              // QPay wants a payer name whenever receiver data is sent.
              name: customer.name ?? customer.phone ?? 'Three33',
              phone: customer.phone ?? undefined,
              email: customer.email ?? undefined,
            }
          : undefined,
      })
    : null

  try {
    await saveAdminInvoice({ input, adminId, orderNo, total, customer, snapshots, invoice })
  } catch (error) {
    // A live invoice with no order behind it: cancel it so nobody can pay it.
    if (provider && invoice) await cancelOrphan(provider, invoice, `${input.method} admin invoice for ${orderNo}`)
    throw error
  }

  // Same background receipt settleOrder sends once a provider confirms.
  if (!invoice) inBackground(`receipt ${orderNo}`, sendOrderReceipt(orderNo))
  return { orderNo }
}

type Snapshot = { sku: string; name: string }

/**
 * Catalog lines are checked against stock now, so the admin hears "only 2
 * left" before a customer is asked to pay. Nothing is reserved — as with web
 * checkout, stock moves when the money lands, and settle.ts's conditional
 * decrement decides it then.
 */
async function variantSnapshots(lines: readonly InvoiceLineInput[]): Promise<Map<string, Snapshot>> {
  const variantLines = lines.flatMap((line) => (line.kind === 'variant' ? [line] : []))
  if (variantLines.length === 0) return new Map()

  const variants = await db
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

  const byId = new Map(variants.map((v) => [v.id, v]))
  return new Map(
    variantLines.map((line): [string, Snapshot] => {
      const variant = byId.get(line.variantId)
      if (!variant) throw new Error('Бараа олдсонгүй — хуудсаа шинэчилнэ үү')
      const label = variant.size ? `${variant.name} ${variant.size}` : variant.name
      if (variant.stockQty < line.qty) {
        throw new Error(`${label}: нөөцөд ${variant.stockQty} ширхэг үлдсэн`)
      }
      return [line.variantId, { sku: variant.sku, name: label }]
    }),
  )
}

/** The order, its lines, its payment and the admin_invoices marker, in one batch. */
async function saveAdminInvoice(invoiceOrder: {
  input: CreateAdminInvoiceInput
  adminId: string
  orderNo: string
  total: number
  customer: { phone: string | null; email: string | null; name: string | null }
  snapshots: Map<string, Snapshot>
  invoice: CreatedInvoice | null
}): Promise<void> {
  const { input, orderNo, total, customer, snapshots, invoice } = invoiceOrder
  const orderId = crypto.randomUUID()
  const paymentId = crypto.randomUUID()

  const items = input.lines.map((line) => {
    if (line.kind === 'variant') {
      const snapshot = snapshots.get(line.variantId)
      assert(snapshot, 'variantSnapshots covers every variant line')
      return { orderId, variantId: line.variantId, skuSnapshot: snapshot.sku, nameSnapshot: snapshot.name, unitPrice: line.unitPrice, qty: line.qty }
    }
    return { orderId, variantId: null, skuSnapshot: CUSTOM_SKU, nameSnapshot: line.name, unitPrice: line.unitPrice, qty: line.qty }
  })
  assert(items.length === input.lines.length, 'one order item per invoice line')

  await atomic([
    db.insert(orders).values({
      id: orderId,
      orderNo,
      cartId: null,
      status: 'pending_payment',
      subtotal: total,
      shippingFee: 0,
      total,
      contactPhone: customer.phone ?? '',
      note: input.note || null,
      expiresAt: new Date(Date.now() + ADMIN_INVOICE_TTL_MS),
      // The token guards the customer-facing payment page; admins don't need
      // it, so only its hash is kept — same as any order.
      accessTokenHash: mintOrderToken().hash,
      shippingAddressSnapshot: { name: customer.name, phone: customer.phone ?? '', email: customer.email },
    }),
    ...insertRows(orderItems, items),
    db.insert(payments).values({
      id: paymentId,
      orderId,
      provider: input.method,
      invoiceId: invoice?.invoiceId ?? null,
      amount: total,
      status: 'pending',
      invoicePayload: invoice
        ? { qrText: invoice.qrText, qrImage: invoice.qrImage, shortUrl: invoice.shortUrl, links: invoice.links }
        : null,
    }),
    db.insert(adminInvoices).values({ orderId, createdBy: invoiceOrder.adminId }),
    /**
     * A manual sale was paid at the counter before it was entered, so it
     * settles here, in the same batch that wrote it — stock and the ledger
     * move exactly as they would for a QPay payment. The order number stands
     * in for a provider payment id, keeping payments_payment_id_key
     * meaningful.
     */
    ...(invoice
      ? []
      : await markPaid({ id: orderId, cartId: null }, paymentId, { paymentId: `manual:${orderNo}`, rawCallback: null }, items)),
  ])
}

/** Cancels an invoice whose order could not be saved; logs if even that fails. */
async function cancelOrphan(provider: PaymentProvider, invoice: CreatedInvoice, label: string): Promise<void> {
  try {
    await provider.cancelInvoice(invoice.invoiceId)
  } catch (cancelError) {
    console.error(`Orphaned ${label}: ${invoice.invoiceId}`, cancelError)
  }
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
  if (head.status === 'pending_payment') await refreshPendingInvoice(orderNo, head)

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

/** Asks the provider about a pending admin invoice, and retires it once lapsed. */
async function refreshPendingInvoice(orderNo: string, head: { id: string; expiresAt: Date }): Promise<void> {
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
