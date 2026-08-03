import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * MONEY RULE: every amount column is BIGINT holding *mungu* (tugrik x 100).
 * Never a float, never a numeric. Conversion to/from display and to/from the
 * QPay API happens in exactly one place: src/lib/money.ts.
 */
const money = (name: string) => bigint(name, { mode: 'number' })

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['customer', 'admin'])

export const productStatus = pgEnum('product_status', [
  'draft',
  'active',
  'archived',
])

/**
 * Order lifecycle. Transitions are enforced in code
 * (src/lib/server/orders/state.ts), not by the database.
 *
 *   pending_payment ─┬─> paid ──> processing ──> shipped ──> delivered
 *                    ├─> expired            (invoice lapsed / sweep)
 *                    └─> cancelled          (customer or admin)
 *   paid|processing|shipped|delivered ──> refunded
 */
export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'expired',
  'refunded',
])

export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'paid',
  'failed',
  'expired',
  'refunded',
])

export const reviewStatus = pgEnum('review_status', [
  'pending',
  'approved',
  'rejected',
])

/** Why stock moved. Every change to product_variants.stock_qty writes one row. */
export const inventoryReason = pgEnum('inventory_reason', [
  'order_paid',
  'order_cancelled',
  'order_refunded',
  'restock',
  'manual_adjustment',
])

// ---------------------------------------------------------------------------
// Users, sessions, addresses
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(), // argon2id
    name: text('name').notNull(),
    role: userRole('role').notNull().default('customer'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
)

/**
 * Server-side sessions, not stateless JWT — deleting the row revokes access
 * immediately. `id` is the SHA-256 hash of the token held in the httpOnly
 * cookie, never the token itself, so a DB dump yields no usable logins.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(), // hash of the emailed token, never the token itself
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_tokens_user_id_idx').on(t.userId)],
)

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    district: text('district').notNull(), // düüreg
    khoroo: text('khoroo').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    phone: text('phone').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [index('addresses_user_id_idx').on(t.userId)],
)

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: id(),
    slug: text('slug').notNull(),
    nameMn: text('name_mn').notNull(),
    nameEn: text('name_en').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug)],
)

export const products = pgTable(
  'products',
  {
    id: id(),
    slug: text('slug').notNull(),
    nameMn: text('name_mn').notNull(),
    nameEn: text('name_en').notNull(),
    descriptionMn: text('description_mn'),
    descriptionEn: text('description_en'),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    brandLine: text('brand_line'), // e.g. "Deluxe Pomade", "Featherweight"
    status: productStatus('status').notNull().default('draft'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('products_slug_key').on(t.slug),
    index('products_category_id_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
  ],
)

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    sizeMl: integer('size_ml'),
    price: money('price').notNull(),
    compareAtPrice: money('compare_at_price'), // strike-through "was" price
    stockQty: integer('stock_qty').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('product_variants_sku_key').on(t.sku),
    index('product_variants_product_id_idx').on(t.productId),
  ],
)

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    alt: text('alt'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('product_images_product_id_idx').on(t.productId)],
)

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const carts = pgTable(
  'carts',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull(), // guest cart cookie
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('carts_session_token_key').on(t.sessionToken),
    index('carts_user_id_idx').on(t.userId),
  ],
)

export const cartItems = pgTable(
  'cart_items',
  {
    id: id(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    /**
     * Display convenience only. Never summed for checkout — the checkout server
     * function re-reads product_variants.price and recomputes the total.
     */
    unitPriceSnapshot: money('unit_price_snapshot').notNull(),
  },
  (t) => [uniqueIndex('cart_items_cart_variant_key').on(t.cartId, t.variantId)],
)

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: id(),
    orderNo: text('order_no').notNull(), // human-facing, also QPay sender_invoice_no
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: orderStatus('status').notNull().default('pending_payment'),
    subtotal: money('subtotal').notNull(),
    shippingFee: money('shipping_fee').notNull(),
    total: money('total').notNull(),
    /** Frozen copy — editing the address book must not rewrite past orders. */
    shippingAddressSnapshot: jsonb('shipping_address_snapshot').notNull(),
    contactPhone: text('contact_phone').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('orders_order_no_key').on(t.orderNo),
    index('orders_user_id_idx').on(t.userId),
    // Drives the reconciliation sweep: pending orders older than 10 minutes.
    index('orders_status_created_at_idx').on(t.status, t.createdAt),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    skuSnapshot: text('sku_snapshot').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    unitPrice: money('unit_price').notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [index('order_items_order_id_idx').on(t.orderId)],
)

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('qpay'),
    qpayInvoiceId: text('qpay_invoice_id'),
    qpayPaymentId: text('qpay_payment_id'),
    amount: money('amount').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    rawCallback: jsonb('raw_callback'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    /**
     * THE idempotency guard. QPay may deliver the same callback more than once,
     * and the reconciliation sweep races with it by design. Both paths insert;
     * this index makes the second one fail loudly instead of double-crediting.
     * Partial, because qpay_payment_id is null until payment actually lands.
     */
    uniqueIndex('payments_qpay_payment_id_key')
      .on(t.qpayPaymentId)
      .where(sql`qpay_payment_id is not null`),
    index('payments_order_id_idx').on(t.orderId),
    index('payments_qpay_invoice_id_idx').on(t.qpayInvoiceId),
  ],
)

// ---------------------------------------------------------------------------
// Reviews & inventory
// ---------------------------------------------------------------------------

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Gate: only orders that reached `delivered` may leave a review. */
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(), // 1..5, checked in the server function
    body: text('body'),
    status: reviewStatus('status').notNull().default('pending'), // moderated
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reviews_product_user_order_key').on(
      t.productId,
      t.userId,
      t.orderId,
    ),
    index('reviews_product_id_status_idx').on(t.productId, t.status),
  ],
)

/**
 * Append-only audit of every stock movement. `product_variants.stock_qty` is the
 * fast read; this is the explanation. Written in the same transaction as the
 * stock change, always.
 */
export const inventoryLedger = pgTable(
  'inventory_ledger',
  {
    id: id(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(), // negative = sold, positive = restocked
    reason: inventoryReason('reason').notNull(),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('inventory_ledger_variant_id_idx').on(t.variantId)],
)

// ---------------------------------------------------------------------------
// Inferred types — import these instead of redeclaring shapes.
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Address = typeof addresses.$inferSelect
export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type ProductVariant = typeof productVariants.$inferSelect
export type ProductImage = typeof productImages.$inferSelect
export type Cart = typeof carts.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
export type Order = typeof orders.$inferSelect
export type OrderItem = typeof orderItems.$inferSelect
export type Payment = typeof payments.$inferSelect
export type Review = typeof reviews.$inferSelect

export type OrderStatus = (typeof orderStatus.enumValues)[number]
export type PaymentStatus = (typeof paymentStatus.enumValues)[number]
