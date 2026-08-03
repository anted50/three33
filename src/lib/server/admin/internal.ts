import { and, asc, count, desc, eq, gte, inArray, sql, sum } from 'drizzle-orm'
import { db } from '~/db'
import {
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  categories,
} from '~/db/schema'
import { isAdmin } from './gate-internal'

/**
 * Server-only admin internals. Never imported from a route — see
 * lib/server/cart/internal.ts for why that boundary matters.
 */

/**
 * Every admin read and write goes through this first.
 *
 * The /admin layout guard runs in beforeLoad, but a server function is a public
 * HTTP endpoint: anyone can call it directly with the right payload, layout or
 * no layout. Route guards decide what renders; this decides what is allowed.
 */
export function assertAdmin(): void {
  if (!isAdmin()) throw new Error('UNAUTHORISED')
}

/** Statuses whose revenue counts as real. */
const EARNING = ['paid', 'processing', 'shipped', 'delivered'] as const

export async function dashboard() {
  assertAdmin()

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [revenue] = await db
    .select({
      total: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
      orders: count(orders.id),
    })
    .from(orders)
    .where(
      and(inArray(orders.status, EARNING), gte(orders.createdAt, monthStart)),
    )

  const [pending] = await db
    .select({ n: count(orders.id) })
    .from(orders)
    .where(eq(orders.status, 'pending_payment'))

  const [toFulfil] = await db
    .select({ n: count(orders.id) })
    .from(orders)
    .where(inArray(orders.status, ['paid', 'processing']))

  const recent = await db
    .select({
      orderNo: orders.orderNo,
      status: orders.status,
      total: orders.total,
      createdAt: orders.createdAt,
      address: orders.shippingAddressSnapshot,
    })
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(8)

  /** Stock that will run out first — the thing a shop actually needs to see. */
  const lowStock = await db
    .select({
      sku: productVariants.sku,
      size: productVariants.size,
      stockQty: productVariants.stockQty,
      name: products.nameMn,
      slug: products.slug,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.isActive, true))
    .orderBy(asc(productVariants.stockQty))
    .limit(8)

  const best = await db
    .select({
      name: orderItems.nameSnapshot,
      units: sql<number>`sum(${orderItems.qty})::int`,
      revenue: sql<number>`sum(${orderItems.unitPrice} * ${orderItems.qty})::bigint`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(inArray(orders.status, EARNING), gte(orders.createdAt, monthStart)),
    )
    .groupBy(orderItems.nameSnapshot)
    .orderBy(desc(sql`sum(${orderItems.qty})`))
    .limit(5)

  return {
    revenueThisMonth: Number(revenue?.total ?? 0),
    ordersThisMonth: revenue?.orders ?? 0,
    pendingPayment: pending?.n ?? 0,
    toFulfil: toFulfil?.n ?? 0,
    recent,
    lowStock,
    best: best.map((b) => ({ ...b, revenue: Number(b.revenue) })),
  }
}

export async function listOrders(status?: string) {
  assertAdmin()

  const rows = await db
    .select({
      orderNo: orders.orderNo,
      status: orders.status,
      total: orders.total,
      createdAt: orders.createdAt,
      phone: orders.contactPhone,
      address: orders.shippingAddressSnapshot,
      // Join + aggregate rather than a correlated subquery: the subquery form
      // returned 0 for every row here, and this is clearer besides.
      items: sql<number>`coalesce(sum(${orderItems.qty}), 0)::int`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      status && status !== 'all'
        ? eq(orders.status, status as never)
        : undefined,
    )
    .groupBy(
      orders.id,
      orders.orderNo,
      orders.status,
      orders.total,
      orders.createdAt,
      orders.contactPhone,
      orders.shippingAddressSnapshot,
    )
    .orderBy(desc(orders.createdAt))
    .limit(200)

  return rows
}

export async function orderDetail(orderNo: string) {
  assertAdmin()

  const [order] = await db
    .select()
    .from(orders)
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
      status: payments.status,
      qpayInvoiceId: payments.qpayInvoiceId,
      qpayPaymentId: payments.qpayPaymentId,
      amount: payments.amount,
      paidAt: payments.paidAt,
    })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1)

  return {
    orderNo: order.orderNo,
    status: order.status,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    contactPhone: order.contactPhone,
    note: order.note,
    address: order.shippingAddressSnapshot,
    createdAt: order.createdAt,
    items,
    payment: payment ?? null,
  }
}

export async function listProducts() {
  assertAdmin()

  const rows = await db
    .select({
      slug: products.slug,
      name: products.nameMn,
      status: products.status,
      category: categories.nameMn,
      variants: sql<number>`count(${productVariants.id})::int`,
      stock: sql<number>`coalesce(sum(${productVariants.stockQty}), 0)::int`,
      minPrice: sql<number>`coalesce(min(${productVariants.price}), 0)::bigint`,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .groupBy(products.id, products.slug, products.nameMn, products.status, categories.nameMn)
    .orderBy(asc(products.nameMn))

  return rows.map((r) => ({ ...r, minPrice: Number(r.minPrice) }))
}

export async function productDetail(slug: string) {
  assertAdmin()

  const [product] = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameMn: products.nameMn,
      nameEn: products.nameEn,
      descriptionMn: products.descriptionMn,
      status: products.status,
      brandLine: products.brandLine,
    })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1)

  if (!product) return null

  const variants = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      price: productVariants.price,
      stockQty: productVariants.stockQty,
      isActive: productVariants.isActive,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, product.id))
    .orderBy(asc(productVariants.price))

  const { id: _id, ...rest } = product
  return { ...rest, variants }
}
