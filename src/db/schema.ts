import { sql, type SQL } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * MONEY RULE: every amount column is BIGINT holding *mungu* (tugrik x 100).
 * Never a float, never a numeric. Conversion to/from display and to/from the
 * QPay API happens in exactly one place: src/lib/money.ts.
 */
const money = (name: string) => integer(name, { mode: 'number' })

/**
 * D1 is SQLite, so the Postgres types this schema was written against are
 * spelled differently but mean the same thing:
 *
 *   uuid         -> text, generated in JS (crypto.randomUUID) at insert
 *   timestamptz  -> integer milliseconds since the epoch, read back as Date
 *   jsonb        -> text holding JSON, parsed on read
 *   boolean      -> integer 0/1, read back as boolean
 *   date         -> text 'YYYY-MM-DD' (it already was, in string mode)
 *   enum         -> text plus a CHECK constraint listing the values
 *
 * Generating ids in JS rather than in the database is not just a quirk:
 * batched writes (src/db/atomic.ts) need a row's id before the batch runs,
 * so a later statement in the same batch can reference it.
 */
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })

/** SQL default for a timestamp column: now, in milliseconds. */
const NOW_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`

const createdAt = () => timestamp('created_at').notNull().default(NOW_MS)

/**
 * A text column restricted to a fixed set of values — SQLite has no enum type.
 * Called like the pgEnum it replaces (`orderStatus('status')`), and keeps
 * `.enumValues` for the inferred types at the bottom of this file. The values
 * are enforced by a CHECK constraint per column (`oneOf`), not just by
 * TypeScript, so imported or hand-written rows cannot smuggle in a typo.
 */
function sqliteEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return Object.assign((name: string) => text(name, { enum: values }), {
    enumValues: values,
  })
}

function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = sqliteEnum(['customer', 'admin'])

export const productStatus = sqliteEnum([
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
export const orderStatus = sqliteEnum([
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'expired',
  'refunded',
])

export const paymentStatus = sqliteEnum([
  'pending',
  'paid',
  'failed',
  'expired',
  'refunded',
])

export const reviewStatus = sqliteEnum([
  'pending',
  'approved',
  'rejected',
])

/** Why stock moved. Every change to product_variants.stock_qty writes one row. */
export const inventoryReason = sqliteEnum([
  'order_paid',
  'order_cancelled',
  'order_refunded',
  'restock',
  'manual_adjustment',
])

// ---------------------------------------------------------------------------
// Users, sessions, addresses
// ---------------------------------------------------------------------------

/**
 * Shape of orders.shipping_address_snapshot. Typed here rather than cast at
 * each read: a JSON column is `unknown` by default, and TanStack Start refuses
 * to serialise `unknown` across the server-function boundary.
 */
export interface ShippingAddress {
  /** Not collected at checkout anymore — kept for orders placed before that changed. */
  name: string | null
  phone: string
  email: string | null
  /** The whole delivery address as one free-text block, as typed. */
  address?: string
  /**
   * Orders placed while the form asked for аймаг/сум/хороо separately keep the
   * fields they were stored with. Readers go through lib/address.ts, which
   * renders either shape.
   */
  province?: string
  district?: string
  khoroo?: string
  line1?: string
  line2?: string | null
  zone?: 'ub' | 'countryside'
  mapLink?: string
}

/**
 * Shape of payments.invoice_payload — the provider's invoice as first
 * returned. A provider with nothing to scan (StorePay invoices arrive in the
 * customer's app by phone number) stores empty qrText/qrImage and no links;
 * the payment page shows its QR and bank panels only when they're non-empty.
 */
export interface InvoicePayload {
  qrText: string
  qrImage: string
  shortUrl: string | null
  links: Array<{
    name: string
    description: string
    logo: string
    link: string
  }>
}

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    phone: text('phone'),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('customer'),
    emailVerifiedAt: timestamp('email_verified_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_role_check', oneOf(t.role, userRole.enumValues)),
  ],
)

/**
 * Server-side sessions, not stateless JWT — deleting the row revokes access
 * immediately. `id` is the SHA-256 hash of the token held in the httpOnly
 * cookie, never the token itself, so a DB dump yields no usable logins.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

/**
 * One-time login codes for the admin OTP flow. Not tied to a user_id — a code
 * is requested by email before we know (or want to reveal) whether an admin
 * account exists for it, so the lookup at verification time goes through
 * email the same way the request did.
 */
export const otpCodes = sqliteTable(
  'otp_codes',
  {
    id: id(),
    email: text('email').notNull(),
    /** SHA-256 of the 6-digit code, never the code itself — same reasoning as
     * sessions.id. */
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_email_idx').on(t.email)],
)

export const addresses = sqliteTable(
  'addresses',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    district: text('district').notNull(), // düüreg
    khoroo: text('khoroo').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    phone: text('phone').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('addresses_user_id_idx').on(t.userId)],
)

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const categories = sqliteTable(
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

export const products = sqliteTable(
  'products',
  {
    id: id(),
    slug: text('slug').notNull(),
    nameMn: text('name_mn').notNull(),
    nameEn: text('name_en').notNull(),
    descriptionMn: text('description_mn'),
    descriptionEn: text('description_en'),
    categoryId: text('category_id').references(() => categories.id, {
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
    check('products_status_check', oneOf(t.status, productStatus.enumValues)),
  ],
)

export const productVariants = sqliteTable(
  'product_variants',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    /**
     * Free text, not a number: the range mixes ml (Salt Spray 150ml) with
     * grams (Deluxe Pomade 100g) and sizeless items (barber capes). Storing
     * "100g" beats a numeric column plus a unit column nobody keeps in sync.
     */
    size: text('size'),
    price: money('price').notNull(),
    compareAtPrice: money('compare_at_price'), // strike-through "was" price
    stockQty: integer('stock_qty').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    uniqueIndex('product_variants_sku_key').on(t.sku),
    index('product_variants_product_id_idx').on(t.productId),
  ],
)

export const productImages = sqliteTable(
  'product_images',
  {
    id: id(),
    productId: text('product_id')
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

export const carts = sqliteTable(
  'carts',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull(), // guest cart cookie
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('carts_session_token_key').on(t.sessionToken),
    index('carts_user_id_idx').on(t.userId),
  ],
)

export const cartItems = sqliteTable(
  'cart_items',
  {
    id: id(),
    cartId: text('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: text('variant_id')
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

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    orderNo: text('order_no').notNull(), // human-facing, also QPay sender_invoice_no
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The cart this order was checked out from. Not decoration: it is how a
     * browser with only a cart cookie finds its way back to an unpaid invoice,
     * and how settlement clears the right cart lines from cron or a callback,
     * where no cookie exists. Nulled rather than cascaded — losing the cart
     * must never take the order with it.
     */
    cartId: text('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    status: orderStatus('status').notNull().default('pending_payment'),
    subtotal: money('subtotal').notNull(),
    shippingFee: money('shipping_fee').notNull(),
    total: money('total').notNull(),
    /** Frozen copy — editing the address book must not rewrite past orders. */
    shippingAddressSnapshot: text('shipping_address_snapshot', { mode: 'json' })
      .$type<ShippingAddress>()
      .notNull(),
    contactPhone: text('contact_phone').notNull(),
    note: text('note'),
    /**
     * When the QPay invoice stops being payable. Explicit rather than a
     * constant in the sweep script, because two things have to agree on it:
     * the page counting down in front of the customer, and the job that
     * cancels the invoice at QPay. A number living in only one of them is how
     * an "expired" order stays payable for three more days.
     */
    expiresAt: timestamp('expires_at').notNull(),
    /**
     * SHA-256 of the token that lets a browser see this order — same reasoning
     * as sessions.id. Order numbers are short and guessable by design (people
     * read them aloud), so they cannot double as the credential that guards a
     * customer's phone number and address.
     */
    accessTokenHash: text('access_token_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('orders_order_no_key').on(t.orderNo),
    index('orders_user_id_idx').on(t.userId),
    // Finds "does this browser have an unpaid order?" from the cart cookie.
    index('orders_cart_id_idx').on(t.cartId),
    // Drives the reconciliation sweep: pending orders older than 10 minutes.
    index('orders_status_created_at_idx').on(t.status, t.createdAt),
    // Drives the expiry half of the same sweep.
    index('orders_pending_expires_idx')
      .on(t.expiresAt)
      .where(sql`status = 'pending_payment'`),
    check('orders_status_check', oneOf(t.status, orderStatus.enumValues)),
  ],
)

export const orderItems = sqliteTable(
  'order_items',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    skuSnapshot: text('sku_snapshot').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    unitPrice: money('unit_price').notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    // removeVariant checks "has this ever been sold?" by variant — without
    // this, that's a sequential scan over every order line ever written.
    index('order_items_variant_id_idx').on(t.variantId),
  ],
)

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('qpay'),
    invoiceId: text('invoice_id'),
    paymentId: text('payment_id'),
    amount: money('amount').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    /**
     * The provider's invoice payload as first returned — QR text/image and bank
     * deeplinks for QPay, whatever the equivalent is for another provider.
     * Stored so reloading the payment page re-renders instantly instead of
     * calling the provider again on every refresh.
     */
    invoicePayload: text('invoice_payload', { mode: 'json' }).$type<InvoicePayload>(),
    rawCallback: text('raw_callback', { mode: 'json' }),
    paidAt: timestamp('paid_at'),
    /**
     * Last time we spent a provider settlement check on this invoice. The
     * payment page polls, and every poll used to be one call to the provider —
     * 20 a minute per customer sitting on the page, and unbounded for anyone
     * hitting the endpoint deliberately. settleOrder reads this to refuse to
     * ask again within a couple of seconds.
     */
    lastCheckedAt: timestamp('last_checked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    /**
     * THE idempotency guard. A provider may deliver the same callback more than
     * once, and the reconciliation sweep races with it by design. Both paths
     * insert; this index makes the second one fail loudly instead of
     * double-crediting. Partial, because payment_id is null until payment
     * actually lands.
     */
    uniqueIndex('payments_payment_id_key')
      .on(t.paymentId)
      .where(sql`payment_id is not null`),
    index('payments_order_id_idx').on(t.orderId),
    index('payments_invoice_id_idx').on(t.invoiceId),
    check('payments_status_check', oneOf(t.status, paymentStatus.enumValues)),
  ],
)

/**
 * Marks an order as issued by an admin from /admin/invoices rather than
 * checked out by a customer. A side table, so orders
 * itself stays as it is: an order is an admin invoice iff it has a row here.
 * Everything else — payment, settlement, stock, expiry — is the ordinary
 * order pipeline.
 */
export const adminInvoices = sqliteTable(
  'admin_invoices',
  {
    orderId: text('order_id')
      .primaryKey()
      .references(() => orders.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('admin_invoices_created_at_idx').on(t.createdAt)],
)

/**
 * Every attempt to turn a cart into an invoice, successful or not.
 *
 * Two jobs. It is the counter the rate limiter reads — checkout mints real
 * invoices on a real merchant account, so it cannot be an unmetered endpoint.
 * And it is the audit trail: when the shop finds junk orders, this is the
 * record of who made them and how fast, which the orders table alone cannot
 * show because rejected attempts never become orders.
 *
 * Append-only. Never updated, never read on the happy path except to count.
 */
export const checkoutAttempts = sqliteTable(
  'checkout_attempts',
  {
    id: id(),
    /** Null behind a proxy that strips it; the phone limit still applies. */
    ip: text('ip'),
    phone: text('phone').notNull(),
    cartId: text('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    orderId: text('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    /** created | reused | rate_limited | invoice_failed */
    outcome: text('outcome').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('checkout_attempts_ip_created_at_idx').on(t.ip, t.createdAt),
    index('checkout_attempts_phone_created_at_idx').on(t.phone, t.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Reviews & inventory
// ---------------------------------------------------------------------------

export const reviews = sqliteTable(
  'reviews',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Gate: only orders that reached `delivered` may leave a review. */
    orderId: text('order_id')
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
    check('reviews_status_check', oneOf(t.status, reviewStatus.enumValues)),
  ],
)

/**
 * Append-only audit of every stock movement. `product_variants.stock_qty` is the
 * fast read; this is the explanation. Written in the same atomic batch as the
 * stock change, always.
 */
/**
 * Shop-wide knobs an admin can turn without a deploy — currently the delivery
 * fee. Values are stored as text and parsed by the module that owns each key
 * (see lib/server/settings.ts), so adding a knob needs no migration.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const inventoryLedger = sqliteTable(
  'inventory_ledger',
  {
    id: id(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(), // negative = sold, positive = restocked
    reason: inventoryReason('reason').notNull(),
    orderId: text('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    actorId: text('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('inventory_ledger_variant_id_idx').on(t.variantId),
    check('inventory_ledger_reason_check', oneOf(t.reason, inventoryReason.enumValues)),
  ],
)

// ---------------------------------------------------------------------------
// Booking — one barber, one shop.
//
// Three tables and nothing else:
//
//   services      what can be booked, each with its own length ("Haircut",
//                 45 minutes). The barber adds and edits them in admin.
//   availability  the windows the barber has opened for booking — any day,
//                 any hours, as many as he likes.
//   appointments  one booking: one service, one time, the customer's contact
//                 details, and the online booking fee that confirmed it.
//
// The shop's address is not data — there is one place and it never changes,
// so the website states it. There are no staff accounts: bookings are
// managed from /admin, by any admin.
//
// Rule: nothing a customer submits is kept unless money arrives. A new
// online booking is a `pending` hold for a few minutes while the fee is paid
// through QPay; paid, it becomes `booked` and the confirmation email goes
// out; unpaid, the sweep deletes it (src/lib/server/booking/sweep.ts).
// The one exception is a booking an admin enters himself — a phone call, a
// walk-in — which is `booked` at once, with no fee.
// ---------------------------------------------------------------------------

/**
 *   online:  pending ──(fee paid)──> booked ──(admin)──> cancelled
 *              └──(fee not paid in time)──> deleted by the sweep
 *   admin:   booked ──(admin)──> cancelled
 *
 * A reschedule keeps the booking `booked` and moves its time.
 */
export const appointmentStatus = sqliteEnum(['pending', 'booked', 'cancelled'])

/** Who made the booking: a customer on the website (and paid the fee), or
 * an admin entering it by hand (no fee). */
export const appointmentSource = sqliteEnum(['online', 'admin'])

export const services = sqliteTable(
  'services',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull(),
    /** What the service costs at the shop, shown on the site. Null = not shown.
     * Only the booking fee is paid online. */
    price: money('price'),
    /** Inactive services can't be booked; there is no delete, so past
     * bookings keep pointing at a real row. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check('services_duration_check', sql`${t.durationMinutes} > 0`),
    check('services_price_check', sql`${t.price} is null or ${t.price} >= 0`),
  ],
)

/**
 * A window the barber is open for bookings. Free times are computed live as
 * availability minus appointments; appointments never point at a window, so
 * editing the schedule never touches a booking.
 *
 * + no overlapping windows: a trigger in the D1 migrations.
 */
export const availability = sqliteTable(
  'availability',
  {
    id: id(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('availability_starts_idx').on(t.startsAt),
    check('availability_range_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
)

/**
 * One booking. The service's name and length are copied in when it is made,
 * so editing a service never rewrites a booking.
 *
 * An online booking's fee is paid once, through QPay, so its payment lives
 * on this row rather than in a payments table of its own. An admin-entered
 * booking has no fee and may have no email.
 *
 * + no two non-cancelled appointments overlap: a trigger in the D1
 *   migrations. Pending holds count, so nobody can take a time someone else
 *   is paying for.
 */
export const appointments = sqliteTable(
  'appointments',
  {
    id: id(),
    /** Short and read aloud, like order_no; also QPay's sender_invoice_no. */
    bookingNo: text('booking_no').notNull(),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    source: appointmentSource('source').notNull().default('online'),
    serviceName: text('service_name').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: appointmentStatus('status').notNull().default('pending'),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    /** Required online — the confirmation goes here; optional for a booking
     * an admin enters from a phone call. */
    customerEmail: text('customer_email'),
    note: text('note'),

    /** The booking fee as charged, frozen when the hold was made. 0 for an
     * admin-entered booking. */
    bookingFee: money('booking_fee').notNull(),
    qpayInvoiceId: text('qpay_invoice_id'),
    qpayPaymentId: text('qpay_payment_id'),
    invoicePayload: text('invoice_payload', { mode: 'json' }).$type<InvoicePayload>(),
    /** Last time we spent a QPay check on this fee — polling is throttled. */
    lastCheckedAt: timestamp('last_checked_at'),
    paidAt: timestamp('paid_at'),

    /** How long an unpaid hold lives. Null once booked. */
    expiresAt: timestamp('expires_at'),
    /** Set once the confirmation email has gone out, so a QPay callback and
     * a poll confirming the same booking can't send it twice. */
    confirmationSentAt: timestamp('confirmation_sent_at'),
    cancelledAt: timestamp('cancelled_at'),
    /** SHA-256 of the token that opens the customer's booking page. */
    accessTokenHash: text('access_token_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('appointments_booking_no_key').on(t.bookingNo),
    index('appointments_starts_idx').on(t.startsAt),
    // Drives the sweep that deletes unpaid holds.
    index('appointments_pending_expires_idx')
      .on(t.expiresAt)
      .where(sql`status = 'pending'`),
    // One QPay payment confirms one booking, even if the callback, a poll and
    // the sweep all race to confirm it.
    uniqueIndex('appointments_qpay_payment_id_key')
      .on(t.qpayPaymentId)
      .where(sql`qpay_payment_id is not null`),
    check('appointments_status_check', oneOf(t.status, appointmentStatus.enumValues)),
    check('appointments_source_check', oneOf(t.source, appointmentSource.enumValues)),
    check('appointments_times_check', sql`${t.endsAt} > ${t.startsAt} and ${t.durationMinutes} > 0`),
    check('appointments_pending_check', sql`${t.status} <> 'pending' or ${t.expiresAt} is not null`),
    // Online: always money in front of it, an email to confirm to, and only
    // ever booked by a paid fee.
    check(
      'appointments_online_check',
      sql`${t.source} <> 'online' or (${t.bookingFee} > 0 and ${t.customerEmail} is not null and (${t.status} = 'pending' or ${t.paidAt} is not null))`,
    ),
    // Admin: booked straight away, nothing to pay online, never a hold.
    check(
      'appointments_admin_check',
      sql`${t.source} <> 'admin' or (${t.bookingFee} = 0 and ${t.status} <> 'pending' and ${t.qpayInvoiceId} is null)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Batch guards — not data.
// ---------------------------------------------------------------------------

/**
 * Inserting into this table always fails: a trigger (see the D1 migration
 * that creates it) aborts with the inserted `code` as the error message.
 *
 * It is how a D1 batch says "stop". D1 has no interactive transactions, so
 * the row locks this app used to take (SELECT ... FOR UPDATE, then decide,
 * then write) cannot exist. Instead the condition the lock protected is
 * re-checked as the batch's first statement — insert a code here unless the
 * condition still holds — and if it no longer does, the whole batch rolls
 * back with that code. See guard() in src/db/atomic.ts.
 */
export const batchGuards = sqliteTable('batch_guards', {
  code: text('code').notNull(),
})

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
export type CheckoutAttempt = typeof checkoutAttempts.$inferSelect
export type Review = typeof reviews.$inferSelect

export type Service = typeof services.$inferSelect
export type Availability = typeof availability.$inferSelect
export type Appointment = typeof appointments.$inferSelect

export type OrderStatus = (typeof orderStatus.enumValues)[number]
export type PaymentStatus = (typeof paymentStatus.enumValues)[number]
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number]
