import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
  'pos_sale', // a barber sold it through the POS (0008); see barber_sale_lines
])

// ---------------------------------------------------------------------------
// Users, sessions, addresses
// ---------------------------------------------------------------------------

/**
 * Shape of orders.shipping_address_snapshot. Typed here rather than cast at
 * each read: a jsonb column is `unknown` by default, and TanStack Start refuses
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

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    phone: text('phone'),
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

/**
 * One-time login codes for the admin OTP flow. Not tied to a user_id — a code
 * is requested by email before we know (or want to reveal) whether an admin
 * account exists for it, so the lookup at verification time goes through
 * email the same way the request did.
 */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    email: text('email').notNull(),
    /** SHA-256 of the 6-digit code, never the code itself — same reasoning as
     * sessions.id. */
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_email_idx').on(t.email)],
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
    /**
     * Free text, not a number: the range mixes ml (Salt Spray 150ml) with
     * grams (Deluxe Pomade 100g) and sizeless items (barber capes). Storing
     * "100g" beats a numeric column plus a unit column nobody keeps in sync.
     */
    size: text('size'),
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
    /**
     * The cart this order was checked out from. Not decoration: it is how a
     * browser with only a cart cookie finds its way back to an unpaid invoice,
     * and how settlement clears the right cart lines from cron or a callback,
     * where no cookie exists. Nulled rather than cascaded — losing the cart
     * must never take the order with it.
     */
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    status: orderStatus('status').notNull().default('pending_payment'),
    subtotal: money('subtotal').notNull(),
    shippingFee: money('shipping_fee').notNull(),
    total: money('total').notNull(),
    /** Frozen copy — editing the address book must not rewrite past orders. */
    shippingAddressSnapshot: jsonb('shipping_address_snapshot')
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
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
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
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    // removeVariant checks "has this ever been sold?" by variant — without
    // this, that's a sequential scan over every order line ever written.
    index('order_items_variant_id_idx').on(t.variantId),
  ],
)

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
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
    invoicePayload: jsonb('invoice_payload').$type<InvoicePayload>(),
    rawCallback: jsonb('raw_callback'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /**
     * Last time we spent a provider settlement check on this invoice. The
     * payment page polls, and every poll used to be one call to the provider —
     * 20 a minute per customer sitting on the page, and unbounded for anyone
     * hitting the endpoint deliberately. settleOrder reads this to refuse to
     * ask again within a couple of seconds.
     */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
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
  ],
)

/**
 * Marks an order as issued by an admin from /admin/invoices rather than
 * checked out by a customer. A side table, like in_store_sales, so orders
 * itself stays as it is: an order is an admin invoice iff it has a row here.
 * Everything else — payment, settlement, stock, expiry — is the ordinary
 * order pipeline.
 */
export const adminInvoices = pgTable(
  'admin_invoices',
  {
    orderId: uuid('order_id')
      .primaryKey()
      .references(() => orders.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
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
export const checkoutAttempts = pgTable(
  'checkout_attempts',
  {
    id: id(),
    /** Null behind a proxy that strips it; the phone limit still applies. */
    ip: text('ip'),
    phone: text('phone').notNull(),
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, {
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
/**
 * Shop-wide knobs an admin can turn without a deploy — currently the delivery
 * fee. Values are stored as text and parsed by the module that owns each key
 * (see lib/server/settings.ts), so adding a knob needs no migration.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

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
// Booking — locations, barbers, their services, shifts and appointments.
//
// Purely additive: nothing above this line is altered. The only references
// into shop tables are foreign keys FROM these tables TO users, orders and
// payments, so dropping every table below restores the shop exactly as it was
// — see drizzle/rollback/0006_booking.down.sql. Full flows and the reasoning
// behind each rule: docs/booking-flows.xlsx.
//
// Two rules shape almost everything here:
//
//  1. Nothing a customer submits is kept unless money arrives. An online
//     booking exists only as a short-lived `pending` hold until its fee is
//     paid; an unpaid hold is deleted, not archived.
//  2. A booking is confirmed only by a paid fee (online) or by the barber
//     entering it themselves. The database refuses a confirmed status without
//     confirmed_at.
//
// Accounts. Customers never have one: their name, phone and email live only
// on the appointment or order that carries their payment, and everything
// reaches them by email. Barbers do: the owner creates the users row and the
// barbers row together from a form (no signup, no passwords), and the barber
// signs in to their own /barber area with the same emailed code as /admin —
// otp_codes and sessions serve both unchanged.
//
// Who is a barber is decided by barbers.user_id + is_active, not by
// users.role: one source of truth, so user_role is left untouched, and access
// ends the moment the owner deactivates the barber.
// ---------------------------------------------------------------------------

export const appointmentSource = pgEnum('appointment_source', [
  'online', // customer booked on the site and paid the fee
  'barber', // barber entered it: phone call, walk-in, extra job after hours
])

/**
 *   pending ──> booked ──┬─> completed
 *      │                 ├─> no_show
 *      │                 └─> cancelled      (barber only; fee kept)
 *      └─> (deleted)     unpaid hold, removed by the sweep
 *
 * Barber-entered bookings start at `booked`.
 */
export const appointmentStatus = pgEnum('appointment_status', [
  'pending',
  'booked',
  'completed',
  'cancelled',
  'no_show',
])

export const appointmentEventKind = pgEnum('appointment_event_kind', [
  'created',
  'rescheduled',
  'updated',
  'flagged', // emergency: needs rescheduling, on the barber's call list
  'cancelled',
  'no_show',
  'completed',
])

export const appointmentPaymentKind = pgEnum('appointment_payment_kind', [
  'booking_fee', // online, up front
  'balance', // at the shop: total - booking_fee, possibly split
])

/**
 * Where the money lands decides the barber's ledger: qpay, pos and
 * bank_transfer arrive in the shop's main account; cash stays in the barber's
 * hand and is owed back (barber_ledger 'cash_collected').
 */
export const paymentMethod = pgEnum('payment_method', [
  'qpay',
  'cash',
  'pos',
  'bank_transfer',
])

export const rentPeriod = pgEnum('rent_period', ['weekly', 'biweekly', 'monthly'])
export const rentStatus = pgEnum('rent_status', ['due', 'paid', 'waived'])
export const rentPaidVia = pgEnum('rent_paid_via', ['direct', 'payout'])

export const barberLedgerKind = pgEnum('barber_ledger_kind', [
  'service_share', // + barber's share of an appointment payment
  'product_commission', // + commission on an in-store sale they rang up
  'cash_collected', // − cash the barber holds and must hand back
  'rent_deduction', // − rent taken out of a payout
  'payout', // − shop pays the barber
  'settlement', // + barber hands money back; owner confirms
  'adjustment', // ± owner correction, note required
])

export const locations = pgTable(
  'locations',
  {
    id: id(),
    slug: text('slug').notNull(),
    nameMn: text('name_mn').notNull(),
    nameEn: text('name_en').notNull(),
    address: text('address').notNull(),
    phone: text('phone'),
    mapLink: text('map_link'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('locations_slug_key').on(t.slug)],
)

export const barbers = pgTable(
  'barbers',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** On every confirmation. Calling the barber is the customer's only way to
     * reschedule or cancel, so it can't be empty. */
    phone: text('phone').notNull(),
    bioMn: text('bio_mn'),
    bioEn: text('bio_en'),
    photoUrl: text('photo_url'),
    /** Cleanup time blocked after each appointment. The barber sets it. */
    bufferMinutes: integer('buffer_minutes').notNull().default(0),
    /** Paid online to book, kept on cancel or no-show. 0 = phone booking only:
     * online booking always needs money in front of it. */
    bookingFee: money('booking_fee').notNull().default(0),
    /** The barber's login, created by the owner with this row. Signing in to
     * /barber (email code only) requires this link and is_active; users.role
     * plays no part. Null = the owner manages this barber, no login. */
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('barbers_slug_key').on(t.slug),
    uniqueIndex('barbers_user_id_key').on(t.userId),
    check('barbers_buffer_minutes_check', sql`${t.bufferMinutes} >= 0`),
    check('barbers_booking_fee_check', sql`${t.bookingFee} >= 0`),
  ],
)

/**
 * A barber's own service at one location — they name it, price it and time
 * it. The same haircut at another branch is another row with its own price;
 * there is no override logic and no owner-defined catalog.
 */
export const services = pgTable(
  'services',
  {
    id: id(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameMn: text('name_mn'),
    descriptionEn: text('description_en'),
    descriptionMn: text('description_mn'),
    price: money('price').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('services_barber_location_idx').on(t.barberId, t.locationId),
    index('services_location_idx').on(t.locationId),
    check('services_price_check', sql`${t.price} >= 0`),
    check('services_duration_check', sql`${t.durationMinutes} > 0`),
  ],
)

/**
 * Planned availability: the windows customers can book online. Dated, not a
 * weekly pattern — barbers work whatever days and places they choose.
 * Appointments never reference shifts; free slots are computed live as shifts
 * minus appointments, so a booking outside every shift (overtime) takes
 * nothing from the plan, and editing a shift never touches a booking.
 *
 * + EXCLUDE (no overlapping shifts per barber) in the migration's SQL.
 */
export const barberShifts = pgTable(
  'barber_shifts',
  {
    id: id(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('barber_shifts_location_starts_idx').on(t.locationId, t.startsAt),
    index('barber_shifts_barber_starts_idx').on(t.barberId, t.startsAt),
    check('barber_shifts_range_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
)

/**
 * The owner–barber deal. Owner-only, and a table of its own rather than
 * columns on barbers so a barber editing their profile can never reach it.
 * A new row per change, never an edit: the terms in force are the latest
 * effective_from <= now, and past ledger rows keep the rate they were earned
 * under.
 */
export const barberTerms = pgTable(
  'barber_terms',
  {
    id: id(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    /** Shop's cut of service payments, in basis points: 3000 = 30%. Integer
     * for the same reason as the MONEY RULE. */
    serviceCutBps: integer('service_cut_bps').notNull().default(0),
    /** Barber's commission on in-store product sales they ring up. */
    productCommissionBps: integer('product_commission_bps')
      .notNull()
      .default(0),
    rentAmount: money('rent_amount').notNull().default(0),
    rentPeriod: rentPeriod('rent_period'),
    /** First due date; later ones are this + n × period. */
    rentStartsOn: date('rent_starts_on'),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('barber_terms_barber_effective_key').on(
      t.barberId,
      t.effectiveFrom,
    ),
    check(
      'barber_terms_bps_check',
      sql`${t.serviceCutBps} between 0 and 10000 and ${t.productCommissionBps} between 0 and 10000`,
    ),
    check(
      'barber_terms_rent_check',
      sql`${t.rentAmount} = 0 or (${t.rentAmount} > 0 and ${t.rentPeriod} is not null and ${t.rentStartsOn} is not null)`,
    ),
  ],
)

/**
 * One row per rent due date, created by the sweep from the terms in force.
 * Paid either directly (owner confirms) or out of a payout (a
 * 'rent_deduction' ledger row points here).
 */
export const rentCharges = pgTable(
  'rent_charges',
  {
    id: id(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    /** Frozen from the terms: changing the rent never rewrites a bill. */
    amount: money('amount').notNull(),
    dueOn: date('due_on').notNull(),
    status: rentStatus('status').notNull().default('due'),
    paidVia: rentPaidVia('paid_via'),
    confirmedBy: uuid('confirmed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    // The sweep can run twice; a barber is still only billed once per date.
    uniqueIndex('rent_charges_barber_due_key').on(t.barberId, t.dueOn),
    index('rent_charges_status_due_idx').on(t.status, t.dueOn),
    check('rent_charges_amount_check', sql`${t.amount} > 0`),
    check(
      'rent_charges_paid_check',
      sql`${t.status} <> 'paid' or ${t.paidVia} is not null`,
    ),
  ],
)

/**
 * One visit: one barber, one location, one or more services.
 *
 * `blocked_until` = ends_at + the barber's buffer, frozen at booking, and it is
 * what the no-overlap constraint uses — so a barber changing their buffer
 * later can't create a clash with bookings that already exist.
 *
 * + EXCLUDE (no overlapping appointments per barber, except cancelled) in the
 *   migration's SQL. Pending holds count, so nobody can take a slot someone
 *   else is paying for.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    bookingNo: text('booking_no').notNull(), // short, read aloud, like order_no
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    source: appointmentSource('source').notNull(),
    status: appointmentStatus('status').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** starts_at + the sum of the line durations. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
    /** The barber's buffer when booked; a reschedule keeps it. */
    bufferMinutes: integer('buffer_minutes').notNull(),
    /** Sum of line prices, frozen. */
    total: money('total').notNull(),
    /** Paid online, frozen. Due at the shop = total − booking_fee. */
    bookingFee: money('booking_fee').notNull(),
    /** How long an unpaid hold lives. Null once confirmed-by-barber. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** The barber who entered it. Null for online bookings, which the fee
     * confirmed. */
    confirmedBy: uuid('confirmed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Set once the confirmation email has gone out, so a QPay callback and
     * the sweep confirming the same booking can't send it twice. */
    confirmationSentAt: timestamp('confirmation_sent_at', {
      withTimezone: true,
    }),
    /** Emergency flag: on the barber's call list until rescheduled or
     * cancelled. */
    needsRescheduleAt: timestamp('needs_reschedule_at', { withTimezone: true }),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    note: text('note'),
    /** SHA-256 of the status-page token — same reasoning as orders. */
    accessTokenHash: text('access_token_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('appointments_booking_no_key').on(t.bookingNo),
    // The barber's day view, and "everyone I have from today to Friday".
    index('appointments_barber_starts_idx').on(t.barberId, t.startsAt),
    index('appointments_location_starts_idx').on(t.locationId, t.startsAt),
    // Drives the sweep that deletes unpaid holds.
    index('appointments_pending_expires_idx')
      .on(t.expiresAt)
      .where(sql`status = 'pending'`),
    // The emergency call list.
    index('appointments_needs_reschedule_idx')
      .on(t.barberId)
      .where(sql`needs_reschedule_at is not null`),
    check(
      'appointments_times_check',
      sql`${t.endsAt} > ${t.startsAt} and ${t.blockedUntil} >= ${t.endsAt} and ${t.bufferMinutes} >= 0`,
    ),
    check(
      'appointments_money_check',
      sql`${t.bookingFee} >= 0 and ${t.bookingFee} <= ${t.total}`,
    ),
    // Rule 2: never confirmed without a confirmation.
    check(
      'appointments_confirmed_check',
      sql`${t.status} not in ('booked', 'completed', 'no_show') or ${t.confirmedAt} is not null`,
    ),
    check(
      'appointments_pending_check',
      sql`${t.status} <> 'pending' or ${t.expiresAt} is not null`,
    ),
    // Rule 1: online bookings always have money in front of them, and an
    // email to send the confirmation to.
    check(
      'appointments_online_check',
      sql`${t.source} <> 'online' or (${t.bookingFee} > 0 and ${t.customerEmail} is not null)`,
    ),
    check(
      'appointments_barber_check',
      sql`${t.source} <> 'barber' or (${t.bookingFee} = 0 and ${t.expiresAt} is null)`,
    ),
  ],
)

/** Lines of an appointment, frozen — editing a service never changes them. */
export const appointmentServices = pgTable(
  'appointment_services',
  {
    id: id(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    nameSnapshot: text('name_snapshot').notNull(),
    priceSnapshot: money('price_snapshot').notNull(),
    durationMinutesSnapshot: integer('duration_minutes_snapshot').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('appointment_services_appointment_id_idx').on(t.appointmentId),
    check(
      'appointment_services_values_check',
      sql`${t.priceSnapshot} >= 0 and ${t.durationMinutesSnapshot} > 0`,
    ),
  ],
)

/** Append-only history. The appointment row holds the current state; this
 * holds how it got there — every move, by whom, from when to when. Holds
 * write nothing here; 'created' is written when the booking is confirmed. */
export const appointmentEvents = pgTable(
  'appointment_events',
  {
    id: id(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    kind: appointmentEventKind('kind').notNull(),
    fromStartsAt: timestamp('from_starts_at', { withTimezone: true }),
    toStartsAt: timestamp('to_starts_at', { withTimezone: true }),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('appointment_events_appointment_id_idx').on(t.appointmentId)],
)

/**
 * The booking fee (online, QPay) and the balance at the shop (any method,
 * possibly split). Mirrors `payments`, but for appointments, so the shop's
 * tables stay untouched.
 */
export const appointmentPayments = pgTable(
  'appointment_payments',
  {
    id: id(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'restrict' }),
    kind: appointmentPaymentKind('kind').notNull(),
    method: paymentMethod('method').notNull(),
    amount: money('amount').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    qpayInvoiceId: text('qpay_invoice_id'),
    qpayPaymentId: text('qpay_payment_id'),
    invoicePayload: jsonb('invoice_payload').$type<InvoicePayload>(),
    rawCallback: jsonb('raw_callback'),
    /** Who took it at the shop. Null for the online fee. */
    receivedByUserId: uuid('received_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // Same idempotency guard as payments: one QPay payment, one row.
    uniqueIndex('appointment_payments_qpay_payment_id_key')
      .on(t.qpayPaymentId)
      .where(sql`qpay_payment_id is not null`),
    // The fee is paid once; the balance may be split over several rows.
    uniqueIndex('appointment_payments_fee_once_key')
      .on(t.appointmentId)
      .where(sql`kind = 'booking_fee' and status = 'paid'`),
    index('appointment_payments_appointment_id_idx').on(t.appointmentId),
    index('appointment_payments_qpay_invoice_id_idx').on(t.qpayInvoiceId),
    check('appointment_payments_amount_check', sql`${t.amount} > 0`),
    check(
      'appointment_payments_qpay_check',
      sql`${t.method} = 'qpay' or ${t.qpayInvoiceId} is null`,
    ),
    check(
      'appointment_payments_fee_method_check',
      sql`${t.kind} <> 'booking_fee' or ${t.method} = 'qpay'`,
    ),
    check(
      'appointment_payments_paid_check',
      sql`${t.status} <> 'paid' or ${t.paidAt} is not null`,
    ),
  ],
)

/**
 * Marks an order as sold in the shop by a barber. A side table instead of new
 * columns on orders, so the shop's own tables stay exactly as they are: an
 * order is an in-store sale iff it has a row here. Written together with the
 * order's first payment — see the in-store flows.
 */
export const inStoreSales = pgTable(
  'in_store_sales',
  {
    orderId: uuid('order_id')
      .primaryKey()
      .references(() => orders.id, { onDelete: 'cascade' }),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('in_store_sales_barber_created_idx').on(t.barberId, t.createdAt),
  ],
)

/**
 * Append-only. A barber's balance = sum(amount): positive means the shop owes
 * the barber, negative means the barber owes the shop (usually cash they
 * hold). Written in the same transaction as the money it records, like
 * inventory_ledger.
 */
export const barberLedger = pgTable(
  'barber_ledger',
  {
    id: id(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    kind: barberLedgerKind('kind').notNull(),
    /** What the customer paid. 0 for payouts and adjustments. */
    grossAmount: money('gross_amount').notNull().default(0),
    /** The percentage used, frozen, so the row explains itself after terms
     * change. */
    rateBps: integer('rate_bps'),
    amount: money('amount').notNull(),
    appointmentPaymentId: uuid('appointment_payment_id').references(
      () => appointmentPayments.id,
      { onDelete: 'restrict' },
    ),
    /** A shop payment on an in-store sale (product commission, cash). */
    paymentId: uuid('payment_id').references(() => payments.id, {
      onDelete: 'restrict',
    }),
    rentChargeId: uuid('rent_charge_id').references(() => rentCharges.id, {
      onDelete: 'restrict',
    }),
    /** A payment taken through the barber's POS (0007). */
    salePaymentId: uuid('sale_payment_id').references(
      () => barberSalePayments.id,
      { onDelete: 'restrict' },
    ),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('barber_ledger_barber_created_idx').on(t.barberId, t.createdAt),
    // Each payment credits each kind once, even when a QPay callback and the
    // sweep race each other; each rent charge is deducted once.
    uniqueIndex('barber_ledger_appointment_payment_kind_key')
      .on(t.appointmentPaymentId, t.kind)
      .where(sql`appointment_payment_id is not null`),
    uniqueIndex('barber_ledger_payment_kind_key')
      .on(t.paymentId, t.kind)
      .where(sql`payment_id is not null`),
    uniqueIndex('barber_ledger_rent_charge_key')
      .on(t.rentChargeId)
      .where(sql`rent_charge_id is not null`),
    uniqueIndex('barber_ledger_sale_payment_kind_key')
      .on(t.salePaymentId, t.kind)
      .where(sql`sale_payment_id is not null`),
    check(
      'barber_ledger_rate_check',
      sql`${t.rateBps} is null or ${t.rateBps} between 0 and 10000`,
    ),
    check(
      'barber_ledger_adjustment_check',
      sql`${t.kind} <> 'adjustment' or ${t.note} is not null`,
    ),
    check(
      'barber_ledger_rent_check',
      sql`${t.kind} <> 'rent_deduction' or ${t.rentChargeId} is not null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Booking, part 2 (migration 0007) — also purely additive.
//
// Which locations a barber works at (owner-managed), explicit days off, and
// the barber's POS: a sale of free-form lines paid by any mix of methods.
// Checking out an appointment is a sale linked to it, so every payment taken
// at the shop — walk-in or booked — goes through one path. appointment_payments
// then only ever holds the online booking fee.
// ---------------------------------------------------------------------------

/** Where a barber may work: owner-managed. Services and shifts can only be
 * placed at a location in this set. */
export const barberLocations = pgTable(
  'barber_locations',
  {
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.barberId, t.locationId] }),
    index('barber_locations_location_idx').on(t.locationId),
  ],
)

/**
 * A day the barber has said they won't work. Together with barber_shifts this
 * gives every day one of three answers for customers: working (has shifts),
 * off (a row here), or unknown (neither — the barber hasn't decided).
 * A day is never both: the schedule API replaces a day as a whole.
 */
export const barberDaysOff = pgTable(
  'barber_days_off',
  {
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'cascade' }),
    /** Local date in Ulaanbaatar time. */
    day: date('day').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.barberId, t.day] })],
)

export const barberSaleStatus = pgEnum('barber_sale_status', [
  'open', // lines set, waiting for payments to add up
  'paid', // payments cover total − credit
  'void', // abandoned by the barber before it was paid
])

/**
 * One POS sale. Lines are free-form — a barber can charge a friend less, or
 * sell a one-off service with its own name — because the barber is logged in
 * and accountable, and every payment lands in their ledger.
 *
 * An appointment checkout is a sale with appointment_id set and `credit` = the
 * booking fee already paid online, so the customer is only asked for the rest.
 */
export const barberSales = pgTable(
  'barber_sales',
  {
    id: id(),
    saleNo: text('sale_no').notNull(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'restrict',
    }),
    status: barberSaleStatus('status').notNull().default('open'),
    /** Sum of lines, frozen when the lines are set. */
    total: money('total').notNull(),
    /** Already paid elsewhere (the booking fee). Due = total − credit. */
    credit: money('credit').notNull().default(0),
    note: text('note'),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    customerEmail: text('customer_email'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('barber_sales_sale_no_key').on(t.saleNo),
    index('barber_sales_barber_created_idx').on(t.barberId, t.createdAt),
    // One live checkout per appointment.
    uniqueIndex('barber_sales_appointment_key')
      .on(t.appointmentId)
      .where(sql`appointment_id is not null and status <> 'void'`),
    check(
      'barber_sales_money_check',
      sql`${t.total} >= 0 and ${t.credit} >= 0 and ${t.credit} <= ${t.total}`,
    ),
    check(
      'barber_sales_credit_check',
      sql`${t.appointmentId} is not null or ${t.credit} = 0`,
    ),
    check(
      'barber_sales_paid_check',
      sql`${t.status} <> 'paid' or ${t.paidAt} is not null`,
    ),
  ],
)

export const barberSaleLines = pgTable(
  'barber_sale_lines',
  {
    id: id(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => barberSales.id, { onDelete: 'cascade' }),
    /** The barber's service it came from, if any. Name and amount are free. */
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    /**
     * A product line (0008). Unlike service lines, the name and unit amount
     * are the owner's listed variant — never the barber's — and stock is
     * deducted when the sale is paid. Set null if the owner later removes
     * the variant; the sku snapshot keeps the line readable.
     */
    variantId: uuid('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    skuSnapshot: text('sku_snapshot'),
    /** The stock movement this line caused, once the sale is paid. */
    inventoryLedgerId: uuid('inventory_ledger_id').references(
      () => inventoryLedger.id,
      { onDelete: 'set null' },
    ),
    name: text('name').notNull(),
    description: text('description'),
    unitAmount: money('unit_amount').notNull(),
    qty: integer('qty').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('barber_sale_lines_sale_id_idx').on(t.saleId),
    check(
      'barber_sale_lines_values_check',
      sql`${t.unitAmount} >= 0 and ${t.qty} > 0`,
    ),
    check(
      'barber_sale_lines_kind_check',
      sql`${t.variantId} is null or ${t.serviceId} is null`,
    ),
  ],
)

/**
 * Money taken for a sale. QPay rows are confirmed by asking QPay; cash, pos
 * and bank_transfer are recorded as paid on entry, on the barber's word —
 * that money lands where no API can see it.
 */
export const barberSalePayments = pgTable(
  'barber_sale_payments',
  {
    id: id(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => barberSales.id, { onDelete: 'restrict' }),
    method: paymentMethod('method').notNull(),
    amount: money('amount').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    qpayInvoiceId: text('qpay_invoice_id'),
    qpayPaymentId: text('qpay_payment_id'),
    invoicePayload: jsonb('invoice_payload').$type<InvoicePayload>(),
    rawCallback: jsonb('raw_callback'),
    receivedByUserId: uuid('received_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('barber_sale_payments_qpay_payment_id_key')
      .on(t.qpayPaymentId)
      .where(sql`qpay_payment_id is not null`),
    index('barber_sale_payments_sale_id_idx').on(t.saleId),
    index('barber_sale_payments_qpay_invoice_id_idx').on(t.qpayInvoiceId),
    check('barber_sale_payments_amount_check', sql`${t.amount} > 0`),
    check(
      'barber_sale_payments_qpay_check',
      sql`${t.method} = 'qpay' or ${t.qpayInvoiceId} is null`,
    ),
    check(
      'barber_sale_payments_paid_check',
      sql`${t.status} <> 'paid' or ${t.paidAt} is not null`,
    ),
  ],
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
export type CheckoutAttempt = typeof checkoutAttempts.$inferSelect
export type Review = typeof reviews.$inferSelect

export type Location = typeof locations.$inferSelect
export type Barber = typeof barbers.$inferSelect
export type Service = typeof services.$inferSelect
export type BarberShift = typeof barberShifts.$inferSelect
export type BarberTerms = typeof barberTerms.$inferSelect
export type RentCharge = typeof rentCharges.$inferSelect
export type Appointment = typeof appointments.$inferSelect
export type AppointmentService = typeof appointmentServices.$inferSelect
export type AppointmentEvent = typeof appointmentEvents.$inferSelect
export type AppointmentPayment = typeof appointmentPayments.$inferSelect
export type InStoreSale = typeof inStoreSales.$inferSelect
export type BarberLedgerEntry = typeof barberLedger.$inferSelect
export type BarberLocation = typeof barberLocations.$inferSelect
export type BarberDayOff = typeof barberDaysOff.$inferSelect
export type BarberSale = typeof barberSales.$inferSelect
export type BarberSaleLine = typeof barberSaleLines.$inferSelect
export type BarberSalePayment = typeof barberSalePayments.$inferSelect

export type OrderStatus = (typeof orderStatus.enumValues)[number]
export type PaymentStatus = (typeof paymentStatus.enumValues)[number]
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number]
export type PaymentMethod = (typeof paymentMethod.enumValues)[number]
