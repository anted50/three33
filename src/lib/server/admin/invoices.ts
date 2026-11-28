import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, insertRows } from '~/db/atomic'
import { assert } from '~/lib/assert'
import { D1_BOUND_PARAMETERS_MAX } from '~/db/limits'
import type { CreateInvoiceInput, CreatedInvoice, PaymentProvider } from '../payments/provider'
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
import { formatMnt, type Mungu } from '~/lib/money'
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
import {
  INVOICE_LINES_MAX,
  invoiceTotal,
  type CreateAdminInvoiceInput,
  type InvoiceLineInput,
} from './invoice-lines'

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
  assert(adminId.length > 0, 'an invoice is issued by a signed-in admin')
  assert(input.lines.length > 0, 'createAdminInvoiceInput requires a line')
  assert(input.lines.length <= INVOICE_LINES_MAX, 'createAdminInvoiceInput caps the lines')

  /** Null for a manual sale: there's no provider to invoice or ask. */
  const providerName = input.method === 'manual' ? null : input.method
  if (providerName !== null) {
    if (!availableProviders().includes(providerName)) {
      throw new Error('Энэ төлбөрийн хэлбэр одоогоор боломжгүй байна')
    }
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
  const invoiceOrder = { input, adminId, orderNo, total, customer, snapshots }

  if (providerName === null) {
    await saveAdminInvoice({ ...invoiceOrder, invoice: null })
    // Same background receipt settleOrder sends once a provider confirms.
    inBackground(`receipt ${orderNo}`, sendOrderReceipt(orderNo))
    return { orderNo }
  }

  // Provider first, rows second — same ordering and reasoning as createOrder.
  const provider = getProvider(providerName)
  const invoice = await provider.createInvoice({
    orderNo,
    amount: total,
    description: `Three33 ${orderNo}`,
    callbackUrl: providerCallbackUrl(providerName, orderNo),
    customer: providerCustomer(customer),
  })

  try {
    await saveAdminInvoice({ ...invoiceOrder, invoice })
  } catch (error) {
    // A live invoice with no order behind it: cancel it so nobody can pay it.
    await cancelOrphan(provider, invoice, `${input.method} admin invoice for ${orderNo}`)
    throw error
  }
  return { orderNo }
}

type Customer = { phone: string | null; email: string | null; name: string | null }

/** The payer as the provider sees it, or nothing when the admin entered nobody. */
function providerCustomer(customer: Customer): CreateInvoiceInput['customer'] {
  if (customer.phone || customer.email || customer.name) {
    return {
      // QPay wants a payer name whenever receiver data is sent.
      name: customer.name ?? customer.phone ?? 'Three33',
      phone: customer.phone ?? undefined,
      email: customer.email ?? undefined,
    }
  }
  return undefined
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
  // createAdminInvoiceInput caps the lines below D1's parameter limit, so one
  // query covers every variant.
  assert(variantLines.length <= D1_BOUND_PARAMETERS_MAX, 'the variant ids fit one D1 statement')

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
    .where(inArray(productVariants.id, variantLines.map((line) => line.variantId)))
  assert(variants.length <= variantLines.length, 'one row per variant id at most')

  const variantById = new Map(variants.map((variant) => [variant.id, variant]))
  const snapshots = new Map<string, Snapshot>()
  for (const line of variantLines) {
    const variant = variantById.get(line.variantId)
    if (!variant) throw new Error('Бараа олдсонгүй — хуудсаа шинэчилнэ үү')
    const label = variant.size ? `${variant.name} ${variant.size}` : variant.name
    if (variant.stockQty < line.qty) {
      throw new Error(`${label}: нөөцөд ${variant.stockQty} ширхэг үлдсэн`)
    }
    snapshots.set(line.variantId, { sku: variant.sku, name: label })
  }
  // The input schema refuses a variant on two rows, so no line overwrote another.
  assert(snapshots.size === variantLines.length, 'one snapshot per variant line')
  return snapshots
}

/** The order, its lines, its payment and the admin_invoices marker, in one batch. */
async function saveAdminInvoice(invoiceOrder: {
  input: CreateAdminInvoiceInput
  adminId: string
  orderNo: string
  total: Mungu
  customer: Customer
  snapshots: Map<string, Snapshot>
  /** Null for a manual sale, which is written already paid. */
  invoice: CreatedInvoice | null
}): Promise<void> {
  const { input, orderNo, total, customer, snapshots, invoice } = invoiceOrder
  assert(total > 0, 'issueAdminInvoice refuses a zero total')
  if (invoice === null) assert(input.method === 'manual', 'only a manual sale has no provider invoice')
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

/** The invoice list shows the most recent ones; older invoices live on as orders. */
const ADMIN_INVOICE_LIST_ROWS_MAX = 50

/** An admin invoice's order holds exactly the invoice's lines. */
const INVOICE_ITEMS_MAX = INVOICE_LINES_MAX

export async function listAdminInvoices() {
  const rows = await db
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
    .limit(ADMIN_INVOICE_LIST_ROWS_MAX)
  assert(rows.length <= ADMIN_INVOICE_LIST_ROWS_MAX, 'the invoice list is capped')
  return rows
}

/**
 * Everything the invoice screen shows. While unpaid it asks the provider
 * first — the same thing the customer's payment page does — so the admin
 * standing at the counter sees "paid" without waiting for the callback.
 * settleOrder throttles how often that actually reaches the provider.
 */
export async function adminInvoiceDetail(orderNo: string) {
  assert(orderNo.length > 0, 'an invoice is looked up by its order number')

  const [head] = await db
    .select({ id: orders.id, status: orders.status, expiresAt: orders.expiresAt })
    .from(orders)
    .innerJoin(adminInvoices, eq(adminInvoices.orderId, orders.id))
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!head) return null
  if (head.status === 'pending_payment') await refreshPendingInvoice(orderNo, head)

  // Read after the refresh, so a payment it just settled shows as paid. One
  // batch: the order, its lines and its payment in a single round trip.
  const [[order], items, [payment]] = await db.batch(invoiceDetailQueries(head.id))

  if (!order) return null
  assert(order.orderNo === orderNo, 'the batch read the invoice the head query found')
  assert(items.length <= INVOICE_ITEMS_MAX, 'an order holds at most INVOICE_ITEMS_MAX lines')

  return {
    ...order,
    expiresAt: order.expiresAt.getTime(),
    items,
    payment: payment ?? null,
  }
}

/** The invoice's order, its lines and its payment, as one batch. */
function invoiceDetailQueries(orderId: string) {
  return [
    db
      .select({
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
      .where(eq(orders.id, orderId))
      .limit(1),
    db
      .select({
        name: orderItems.nameSnapshot,
        sku: orderItems.skuSnapshot,
        unitPrice: orderItems.unitPrice,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      // Insertion order, i.e. the order the admin entered the lines in. The
      // ids are random UUIDs, so ordering by them shuffled the lines.
      .orderBy(asc(sql`${orderItems}.rowid`))
      .limit(INVOICE_ITEMS_MAX + 1),
    db
      .select({
        provider: payments.provider,
        status: payments.status,
        payload: payments.invoicePayload,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1),
  ] as const
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
