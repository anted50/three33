import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  sql,
} from 'drizzle-orm'
import { db } from '~/db'
import { atomic, changed, exists, guard } from '~/db/atomic'
import { isGuardFailure } from '../api/db-errors'
import {
  inventoryLedger,
  orderItems,
  orders,
  payments,
  productImages,
  productVariants,
  products,
  categories,
} from '~/db/schema'
import { assertAdminSession } from './auth-internal'
import { slugify } from '~/lib/slugify'
import { sizeSuffix } from '~/lib/product-name'

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
export async function assertAdmin(): Promise<{ id: string }> {
  return assertAdminSession()
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

/**
 * The UTC calendar day of a timestamp column, as 'YYYY-MM-DD' — the buckets
 * the dashboard's month (also UTC, see monthStart) is counted in. Columns hold
 * epoch milliseconds; strftime wants seconds.
 */
function utcDay(column: typeof orders.createdAt) {
  return sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`
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
      total: sql<number>`coalesce(sum(${orders.total}), 0)`,
      orders: count(orders.id),
    })
    .from(orders)
    .where(earnedThisMonth)

  /** Daily revenue, for the bar sparkline on the sales card. */
  const salesByDay = await db
    .select({
      day: utcDay(orders.createdAt),
      value: sql<number>`coalesce(sum(${orders.total}), 0)`,
    })
    .from(orders)
    .where(earnedThisMonth)
    .groupBy(utcDay(orders.createdAt))

  /**
   * "Customers" counts distinct phone numbers, not user accounts — checkout is
   * guest-only until auth lands, so orders carry no user_id. Phone is the
   * closest thing to a stable identity we actually collect.
   */
  const [customers] = await db
    .select({
      n: sql<number>`count(distinct ${orders.contactPhone})`,
    })
    .from(orders)
    .where(earnedThisMonth)

  const customersByDay = await db
    .select({
      day: utcDay(orders.createdAt),
      value: sql<number>`count(distinct ${orders.contactPhone})`,
    })
    .from(orders)
    .where(earnedThisMonth)
    .groupBy(utcDay(orders.createdAt))

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
        select count(*) from ${orderItems}
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
      units: sql<number>`sum(${orderItems.qty})`,
      revenue: sql<number>`sum(${orderItems.unitPrice} * ${orderItems.qty})`,
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

export interface OrdersFilter {
  status?: string
  /** Inclusive, as a 'YYYY-MM-DD' date — the admin picks a day, not a
   * timestamp. */
  dateFrom?: string
  dateTo?: string
}

/**
 * Runs on orders_status_created_at_idx when a status is given — the common
 * case, since the order list defaults to a status chip. A date-only filter
 * with no status falls back to a plain scan, which is fine at the order
 * volumes this shop sees; worth a dedicated index only if that stops holding.
 */
/**
 * Checkouts nobody paid for. Kept out of the default view: a rate-limited
 * public endpoint still mints one of these for every abandoned or junk
 * attempt, and a list where real orders have to be picked out from among them
 * is a list the shop stops reading. `pending_payment` is that same junk before
 * it has timed out, so it's hidden as well and has no chip of its own.
 */
const ABANDONED = ['expired', 'cancelled', 'pending_payment'] as const

function ordersWhereClause(filter: OrdersFilter) {
  const clauses = []
  if (filter.status && filter.status !== 'all') {
    clauses.push(eq(orders.status, filter.status as never))
  } else {
    // Reachable through their own status chips, just not mixed into "all".
    clauses.push(notInArray(orders.status, [...ABANDONED]))
  }
  if (filter.dateFrom) {
    clauses.push(gte(orders.createdAt, new Date(`${filter.dateFrom}T00:00:00.000Z`)))
  }
  if (filter.dateTo) {
    clauses.push(lte(orders.createdAt, new Date(`${filter.dateTo}T23:59:59.999Z`)))
  }
  return clauses.length > 0 ? and(...clauses) : undefined
}

function ordersQuery(where: ReturnType<typeof ordersWhereClause>) {
  return db
    .select({
      orderNo: orders.orderNo,
      status: orders.status,
      total: orders.total,
      createdAt: orders.createdAt,
      phone: orders.contactPhone,
      address: orders.shippingAddressSnapshot,
      // Join + aggregate rather than a correlated subquery: the subquery form
      // returned 0 for every row here, and this is clearer besides.
      items: sql<number>`coalesce(sum(${orderItems.qty}), 0)`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(where)
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
}

export async function listOrders(
  filter: OrdersFilter & { page?: number; pageSize?: number },
) {
  await assertAdmin()

  const page = filter.page && filter.page > 0 ? filter.page : 1
  const pageSize =
    filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 50
  const where = ordersWhereClause(filter)

  // One round trip for the page, one for the count it's paginating against —
  // not the count query issued once per page-size guess.
  const [rows, [totalRow]] = await Promise.all([
    ordersQuery(where)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count(orders.id) }).from(orders).where(where),
  ])

  return { rows, total: totalRow?.value ?? 0, page, pageSize }
}

/**
 * Every order matching the filter, unpaginated — backs the Excel export,
 * which has to cover everything the admin filtered to, not just the page
 * they're currently looking at.
 */
export async function listOrdersForExport(filter: OrdersFilter) {
  await assertAdmin()
  return ordersQuery(ordersWhereClause(filter))
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
      provider: payments.provider,
      invoiceId: payments.invoiceId,
      paymentId: payments.paymentId,
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
      variants: sql<number>`count(${productVariants.id})`,
      stock: sql<number>`coalesce(sum(${productVariants.stockQty}), 0)`,
      minPrice: sql<number>`coalesce(min(${productVariants.price}), 0)`,
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

  const images = await db
    .select({ url: productImages.url, alt: productImages.alt })
    .from(productImages)
    .where(eq(productImages.productId, product.id))
    .orderBy(asc(productImages.sortOrder))

  const { id: _id, ...rest } = product
  return { ...rest, variants, images }
}

/**
 * Every variant in the shop, flattened for the stock-receipt picker. Inactive
 * ones are included: restocking is usually how a variant comes back on sale.
 */
export async function listVariants() {
  await assertAdmin()

  return db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      price: productVariants.price,
      stockQty: productVariants.stockQty,
      isActive: productVariants.isActive,
      productName: products.nameMn,
      productSlug: products.slug,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .orderBy(asc(products.nameMn), asc(productVariants.price))
}

export async function categoryOptions() {
  await assertAdmin()

  return db
    .select({ id: categories.id, nameMn: categories.nameMn })
    .from(categories)
    .orderBy(asc(categories.sortOrder))
}

/**
 * Categories with how many products sit in each — one query with a join and
 * a group-by, not a count-per-category loop. The join runs on
 * products_category_id_idx.
 */
export async function listCategories() {
  await assertAdmin()

  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      nameMn: categories.nameMn,
      nameEn: categories.nameEn,
      sortOrder: categories.sortOrder,
      productCount: count(products.id),
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder))
}

export interface NewCategoryInput {
  slug: string
  nameMn: string
  nameEn: string
  sortOrder: number
}

export async function insertCategory(input: NewCategoryInput) {
  await assertAdmin()

  const [created] = await db
    .insert(categories)
    .values({
      slug: input.slug,
      nameMn: input.nameMn,
      nameEn: input.nameEn,
      sortOrder: input.sortOrder,
    })
    .returning({ id: categories.id })

  if (!created) throw new Error('Ангилал үүсгэж чадсангүй')
  return { id: created.id }
}

/**
 * Renames a category in both languages. The slug is deliberately left alone —
 * it is what storefront links and the nav filter are built on, so changing it
 * stays a delete-and-recreate decision.
 */
export async function updateCategoryNames(
  categoryId: string,
  names: { nameMn: string; nameEn: string },
) {
  await assertAdmin()

  const [updated] = await db
    .update(categories)
    .set({ nameMn: names.nameMn, nameEn: names.nameEn })
    .where(eq(categories.id, categoryId))
    .returning({ id: categories.id })

  if (!updated) throw new Error('Ангилал олдсонгүй')
  return { ok: true as const }
}

export async function updateCategorySortOrder(categoryId: string, sortOrder: number) {
  await assertAdmin()

  const [updated] = await db
    .update(categories)
    .set({ sortOrder })
    .where(eq(categories.id, categoryId))
    .returning({ id: categories.id })

  if (!updated) throw new Error('Ангилал олдсонгүй')
  return { ok: true as const }
}

/**
 * Refuses to remove a category still holding products — products.category_id
 * is nullable and set-null on delete, so nothing would break, but silently
 * knocking a batch of products out of the storefront nav is the kind of thing
 * that should be a deliberate reassignment, not a side effect of cleanup.
 * The check runs on products_category_id_idx.
 */
export async function removeCategory(categoryId: string) {
  await assertAdmin()

  const [inUse] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.categoryId, categoryId))
    .limit(1)

  if (inUse) {
    throw new Error(
      'Энэ ангилалд бүтээгдэхүүн хамаарч байгаа тул устгах боломжгүй — эхлээд өөр ангилалд шилжүүлнэ үү',
    )
  }

  const [deleted] = await db
    .delete(categories)
    .where(eq(categories.id, categoryId))
    .returning({ id: categories.id })

  if (!deleted) throw new Error('Ангилал олдсонгүй')

  return { ok: true as const }
}

export interface NewProductInput {
  slug: string
  nameMn: string
  nameEn: string
  descriptionMn: string | null
  categoryId: string | null
  brandLine: string | null
  status: 'draft' | 'active' | 'archived'
  variants: Array<{
    sku: string
    size: string | null
    price: number
    stockQty: number
  }>
  images: Array<{ url: string; alt: string | null }>
}

/**
 * A product with no variant has nothing a shopper can add to cart, so
 * registration always creates its variants alongside the product row —
 * one atomic batch, so a failed variant insert never leaves a stub product
 * hanging around in the catalogue.
 */
export async function insertProduct(input: NewProductInput) {
  await assertAdmin()

  const productId = crypto.randomUUID()

  await atomic([
    db.insert(products).values({
      id: productId,
      slug: input.slug,
      nameMn: input.nameMn,
      nameEn: input.nameEn,
      descriptionMn: input.descriptionMn,
      categoryId: input.categoryId,
      brandLine: input.brandLine,
      status: input.status,
    }),
    db.insert(productVariants).values(
      input.variants.map((variant) => ({
        productId,
        sku: variant.sku,
        size: variant.size,
        price: variant.price,
        stockQty: variant.stockQty,
      })),
    ),
    input.images.length > 0 &&
      db.insert(productImages).values(
        input.images.map((image, i) => ({
          productId,
          url: image.url,
          alt: image.alt,
          sortOrder: i,
        })),
      ),
  ])

  return { slug: input.slug }
}

/**
 * Adds one variant to a product that already exists — new sizes, colors, or
 * any other variation showing up after the product was first listed. Same
 * ledger discipline as receiveStock/setVariant: an opening stock count above
 * zero gets its own inventory_ledger row, so it has the same paper trail a
 * later restock would.
 */
export async function insertVariant(
  slug: string,
  variant: { sku: string; size: string | null; price: number; stockQty: number },
) {
  await assertAdmin()

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1)

  if (!product) throw new Error('Бүтээгдэхүүн олдсонгүй')

  const id = crypto.randomUUID()

  await atomic([
    db.insert(productVariants).values({
      id,
      productId: product.id,
      sku: variant.sku,
      size: variant.size,
      price: variant.price,
      stockQty: variant.stockQty,
    }),
    variant.stockQty > 0 &&
      db.insert(inventoryLedger).values({
        variantId: id,
        delta: variant.stockQty,
        reason: 'restock',
      }),
  ])

  return { id }
}

/**
 * Removes a variant outright — for the mistake just added, or a size that
 * never sold. Refuses if it has ever shipped in a real order: that's a
 * business record, not a draft, and order_items keeps its own name/SKU
 * snapshot regardless, so the row survives a variant delete either way — this
 * guard is about not letting the catalogue quietly disagree with history.
 * Deactivating (the checkbox already on each row) is the right move there.
 * Also refuses to take the last variant off a product, since a product with
 * none has nothing a shopper can add to cart.
 */
export async function removeVariant(variantId: string) {
  await assertAdmin()

  const [variant] = await db
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1)

  if (!variant) throw new Error('Хувилбар олдсонгүй')

  const [sold] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.variantId, variantId))
    .limit(1)

  if (sold) throw new Error(VARIANT_SOLD_MESSAGE)

  const [siblings] = await db
    .select({ value: count(productVariants.id) })
    .from(productVariants)
    .where(eq(productVariants.productId, variant.productId))

  // No row at all counts as no siblings, which earns the same refusal.
  if ((siblings?.value ?? 0) <= 1) throw new Error(LAST_VARIANT_MESSAGE)

  try {
    // Both checks again, atomically with the delete: an order or another
    // delete may have landed since they were read.
    await atomic([
      guard(sql`not ${exists(db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.variantId, variantId)))}`, 'VARIANT_SOLD'),
      hasSiblings(variant.productId),
      db.delete(productVariants).where(eq(productVariants.id, variantId)),
    ])
  } catch (error) {
    if (isGuardFailure(error, 'VARIANT_SOLD')) throw new Error(VARIANT_SOLD_MESSAGE)
    if (isGuardFailure(error, 'LAST_VARIANT')) throw new Error(LAST_VARIANT_MESSAGE)
    throw error
  }

  return { ok: true as const }
}

const VARIANT_SOLD_MESSAGE = 'Энэ хувилбараар захиалга орсон тул устгах боломжгүй — идэвхгүй болгоно уу'
const LAST_VARIANT_MESSAGE = 'Бүтээгдэхүүнд ядаж нэг хувилбар байх ёстой'

/** Batch guard: the product still has more than one variant. */
function hasSiblings(productId: string) {
  return guard(
    sql`(select count(*) from ${productVariants} where ${productVariants.productId} = ${productId}) > 1`,
    'LAST_VARIANT',
  )
}

/**
 * Promotes one variant to a product of its own.
 *
 * The variant row is *moved*, not copied: cart_items, order_items and
 * inventory_ledger all point at variant ids, so re-creating it under a new id
 * would strand live carts and detach the stock history from the thing it
 * describes. Re-parenting keeps the SKU, the stock count and every reference
 * intact — only which product it hangs off changes.
 *
 * Images are copied rather than moved, since the parent still needs its own,
 * and the description/category/brand line carry over so the new listing starts
 * as a sibling rather than a blank draft.
 *
 * Refuses on the last variant: the parent would be left unbuyable, and a
 * one-variant product is already its own item.
 */
export async function splitVariantIntoProduct(variantId: string) {
  await assertAdmin()

  const [variant] = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      size: productVariants.size,
    })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1)

  if (!variant) throw new Error('Хувилбар олдсонгүй')

  const [parent] = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameMn: products.nameMn,
      nameEn: products.nameEn,
      descriptionMn: products.descriptionMn,
      descriptionEn: products.descriptionEn,
      categoryId: products.categoryId,
      brandLine: products.brandLine,
      status: products.status,
    })
    .from(products)
    .where(eq(products.id, variant.productId))
    .limit(1)

  if (!parent) throw new Error('Бүтээгдэхүүн олдсонгүй')

  const [siblings] = await db
    .select({ value: count(productVariants.id) })
    .from(productVariants)
    .where(eq(productVariants.productId, parent.id))

  if ((siblings?.value ?? 0) <= 1) throw new Error(SPLIT_SINGLE_MESSAGE)

  // The size is what tells the two listings apart; SKU is the fallback for
  // variants that carry no size at all.
  const suffix = variant.size?.trim() || variant.sku

  const base = slugify(`${parent.slug}-${suffix}`) || slugify(variant.sku)
  const slug = await uniqueProductSlug(base)

  const images = await db
    .select({
      url: productImages.url,
      alt: productImages.alt,
      sortOrder: productImages.sortOrder,
    })
    .from(productImages)
    .where(eq(productImages.productId, parent.id))
    .orderBy(asc(productImages.sortOrder))

  const productId = crypto.randomUUID()

  try {
    await atomic([
      hasSiblings(parent.id),
      db.insert(products).values({
        id: productId,
        slug,
        // sizeSuffix keeps a parent already named after the size ("… 30g")
        // from becoming "… 30g 30g".
        nameMn: `${parent.nameMn}${sizeSuffix(parent.nameMn, suffix)}`,
        nameEn: `${parent.nameEn}${sizeSuffix(parent.nameEn, suffix)}`,
        descriptionMn: parent.descriptionMn,
        descriptionEn: parent.descriptionEn,
        categoryId: parent.categoryId,
        brandLine: parent.brandLine,
        status: parent.status,
      }),
      images.length > 0 &&
        db.insert(productImages).values(
          images.map((image, i) => ({
            productId,
            url: image.url,
            alt: image.alt,
            sortOrder: i,
          })),
        ),
      // Scoped to the parent it was read under, so a variant moved elsewhere
      // in the meantime is not silently re-parented again.
      db
        .update(productVariants)
        .set({ productId })
        .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, parent.id))),
      changed('VARIANT_MOVED'),
    ])
  } catch (error) {
    if (isGuardFailure(error, 'LAST_VARIANT')) throw new Error(SPLIT_SINGLE_MESSAGE)
    if (isGuardFailure(error, 'VARIANT_MOVED')) throw new Error('Хувилбар энэ хооронд өөрчлөгдсөн байна')
    throw error
  }

  return { slug }
}

const SPLIT_SINGLE_MESSAGE =
  'Ганц хувилбартай бүтээгдэхүүнийг салгах шаардлагагүй — энэ нь өөрөө тусдаа бараа'

/**
 * Finds a free slug near `base`, appending -2, -3 … until one is unused. The
 * split button names the new product itself, so it cannot lean on the admin to
 * resolve a collision the way the create form does.
 */
async function uniqueProductSlug(base: string): Promise<string> {
  const seed = base || 'product'

  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? seed : `${seed}-${attempt}`
    const [taken] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, candidate))
      .limit(1)

    if (!taken) return candidate
  }

  throw new Error('Чөлөөтэй slug олдсонгүй — гараар үүсгэнэ үү')
}

/**
 * Replaces a product's image list wholesale. Images are ordered by position in
 * the array — the first one is what the catalogue and cart show — so a reorder
 * and a removal are the same operation and cannot half-apply.
 */
export async function replaceProductImages(
  slug: string,
  images: Array<{ url: string; alt: string | null }>,
) {
  await assertAdmin()

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1)

  if (!product) throw new Error('Бүтээгдэхүүн олдсонгүй')

  await atomic([
    db.delete(productImages).where(eq(productImages.productId, product.id)),
    images.length > 0 &&
      db.insert(productImages).values(
        images.map((image, i) => ({
          productId: product.id,
          url: image.url,
          alt: image.alt,
          sortOrder: i,
        })),
      ),
  ])
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
