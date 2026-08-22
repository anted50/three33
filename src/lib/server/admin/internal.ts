import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '~/db'
import {
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  categories,
} from '~/db/schema'
import { assertAdminSession } from './auth-internal'

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
export async function assertAdmin(): Promise<void> {
  await assertAdminSession()
}

/** Statuses whose revenue counts as real. */
const EARNING = ['paid', 'processing', 'shipped', 'delivered'] as const

/** Orders/month the shop is aiming at. Drives the goal card's progress bar. */
const MONTHLY_ORDER_GOAL = Number(process.env.MONTHLY_ORDER_GOAL ?? 100)

/** Turns sparse `YYYY-MM-DD -> value` rows into one entry per day so far. */
function fillDays(
  rows: Array<{ day: string; value: number }>,
  monthStart: Date,
): number[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r.value]))
  const days: number[] = []

  const cursor = new Date(monthStart)
  const today = new Date()

  while (cursor <= today) {
    days.push(byDay.get(cursor.toISOString().slice(0, 10)) ?? 0)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return days
}

export async function dashboard() {
  await assertAdmin()

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const earnedThisMonth = and(
    inArray(orders.status, EARNING),
    gte(orders.createdAt, monthStart),
  )

  const [revenue] = await db
    .select({
      total: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
      orders: count(orders.id),
    })
    .from(orders)
    .where(earnedThisMonth)

  /** Daily revenue, for the bar sparkline on the sales card. */
  const salesByDay = await db
    .select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      value: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
    })
    .from(orders)
    .where(earnedThisMonth)
    .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)

  /**
   * "Customers" counts distinct phone numbers, not user accounts — checkout is
   * guest-only until auth lands, so orders carry no user_id. Phone is the
   * closest thing to a stable identity we actually collect.
   */
  const [customers] = await db
    .select({
      n: sql<number>`count(distinct ${orders.contactPhone})::int`,
    })
    .from(orders)
    .where(earnedThisMonth)

  const customersByDay = await db
    .select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      value: sql<number>`count(distinct ${orders.contactPhone})::int`,
    })
    .from(orders)
    .where(earnedThisMonth)
    .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)

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
      // The frame's "Item" column shows what was bought, not the order number.
      item: sql<string | null>`(
        select ${orderItems.nameSnapshot}
        from ${orderItems}
        where ${orderItems.orderId} = ${orders.id}
        order by ${orderItems.id}
        limit 1
      )`,
      lines: sql<number>`(
        select count(*)::int from ${orderItems}
        where ${orderItems.orderId} = ${orders.id}
      )`,
    })
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(5)

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

  const bestRows = best.map((b) => ({ ...b, revenue: Number(b.revenue) }))
  const bestTotal = bestRows.reduce((sum, b) => sum + b.revenue, 0)
  const ordersThisMonth = revenue?.orders ?? 0

  return {
    revenueThisMonth: Number(revenue?.total ?? 0),
    ordersThisMonth,
    salesSeries: fillDays(
      salesByDay.map((r) => ({ day: r.day, value: Number(r.value) })),
      monthStart,
    ),

    customersThisMonth: customers?.n ?? 0,
    customerSeries: fillDays(customersByDay, monthStart),

    orderGoal: MONTHLY_ORDER_GOAL,
    ordersLeft: Math.max(MONTHLY_ORDER_GOAL - ordersThisMonth, 0),

    pendingPayment: pending?.n ?? 0,
    toFulfil: toFulfil?.n ?? 0,

    recent,
    lowStock,
    best: bestRows,
    bestTotal,
  }
}

export async function listOrders(status?: string) {
  await assertAdmin()

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
  await assertAdmin()

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
  await assertAdmin()

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
  await assertAdmin()

  const [product] = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameMn: products.nameMn,
      nameEn: products.nameEn,
      descriptionMn: products.descriptionMn,
      categoryId: products.categoryId,
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

export async function categoryOptions() {
  await assertAdmin()

  return db
    .select({ id: categories.id, nameMn: categories.nameMn })
    .from(categories)
    .orderBy(asc(categories.sortOrder))
}

export interface NewProductInput {
  slug: string
  nameMn: string
  nameEn: string
  descriptionMn: string | null
  categoryId: string | null
  brandLine: string | null
  status: 'draft' | 'active' | 'archived'
  sku: string
  size: string | null
  price: number
  stockQty: number
}

/**
 * A product with no variant has nothing a shopper can add to cart, so
 * registration always creates the first one alongside the product row —
 * same transaction, so a failed variant insert never leaves a stub product
 * hanging around in the catalogue.
 */
export async function insertProduct(input: NewProductInput) {
  await assertAdmin()

  return db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        slug: input.slug,
        nameMn: input.nameMn,
        nameEn: input.nameEn,
        descriptionMn: input.descriptionMn,
        categoryId: input.categoryId,
        brandLine: input.brandLine,
        status: input.status,
      })
      .returning({ id: products.id })

    if (!product) throw new Error('Бүтээгдэхүүн үүсгэж чадсангүй')

    await tx.insert(productVariants).values({
      productId: product.id,
      sku: input.sku,
      size: input.size,
      price: input.price,
      stockQty: input.stockQty,
    })

    return { slug: input.slug }
  })
}

export interface ProductUpdate {
  slug: string
  nameMn: string
  nameEn: string
  descriptionMn: string | null
  categoryId: string | null
  brandLine: string | null
  status: 'draft' | 'active' | 'archived'
}

/** Slug is the lookup key here, not something this edits — see ProductForm's
 * slugEditable prop for why. */
export async function updateProductRow(input: ProductUpdate) {
  await assertAdmin()

  await db
    .update(products)
    .set({
      nameMn: input.nameMn,
      nameEn: input.nameEn,
      descriptionMn: input.descriptionMn,
      categoryId: input.categoryId,
      brandLine: input.brandLine,
      status: input.status,
    })
    .where(eq(products.slug, input.slug))

  return { ok: true as const }
}
