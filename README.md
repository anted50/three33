# Three33 Barber

Storefront and barber booking for Three33 Barber (Uppercut Deluxe in Mongolia).
TanStack Start on Cloudflare Workers, D1 (SQLite) with Drizzle, payments
through QPay and StorePay.

## Quick start

Needs **Node 26** and npm. There's no database server: locally, D1 is a SQLite
file under `.wrangler/state`, and `npm run dev` runs the server code inside
workerd, the same runtime as production.

```bash
npm install
cp .env.example .dev.vars        # mock values; enough to boot
npm run db:migrate               # create the tables in the local D1
npm run db:seed                  # the catalogue, placeholder prices
npm run admin:add -- you@example.com "Your Name"
npm run dev                      # http://localhost:3000
```

Admins sign in with an emailed code. Without `RESEND_API_KEY`, the code is
printed in the dev server's console. Vite reads `VITE_*` variables only from
`.env*` files, so the two `VITE_PUBLIC_POSTHOG_*` lines also go in
`.env.development.local`.

## Environments and deploys

| | URL | D1 database | Deployed by |
|---|---|---|---|
| Local | http://localhost:3000 | `.wrangler/state` | `npm run dev` |
| Staging | https://staging.three33barber.com | `three33-staging` | a push to `staging` |
| Production | https://three33barber.com (`www.` redirects) | `three33` | a push to `production` |

```
feature/* ──PR──▶ staging ──PR──▶ production
```

[`ci.yml`](.github/workflows/ci.yml) runs `verify` on every pull request and
push. It checks that the migrations match the schema, applies them to a
throwaway D1, builds and dry-runs both environments, and runs the type check
and tests. A push to `staging` or `production` that passes then applies that
environment's D1 migrations, then deploys its Worker. A failed migration stops
the deploy. Run `npm run verify` locally for the same check.

Both environments are set up in [`wrangler.jsonc`](wrangler.jsonc): production
at the top level, staging under `env.staging`. They use the real QPay merchant
(there is no sandbox). Only production runs cron jobs. Secrets are per Worker:
`npx wrangler secret put NAME [--env staging]`. Rollback, secrets and the API
token are covered in [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md).

## Data model

[`src/db/schema.ts`](src/db/schema.ts) is the source of truth, and
`drizzle/` holds the generated migrations plus hand-written triggers. Column
conventions:

- **Money** is an integer in *mungu* (₮ × 100). Convert only through
  `src/lib/money.ts`.
- **Ids** are text UUIDs, generated in JS so a batch can refer to a row before
  it exists.
- **Timestamps** are integer milliseconds; dates are `YYYY-MM-DD` text in
  Ulaanbaatar time.
- **Enums** are text columns with a `CHECK` constraint.

| Area | Tables |
|---|---|
| Accounts | `users` (role `customer`/`admin`) · `sessions` (the SHA-256 hash of the cookie token) · `otp_codes` (sign-in codes) · `addresses` |
| Catalogue | `categories` · `products` (`draft`/`active`/`archived`) · `product_variants` (SKU, size, price, `stock_qty`) · `product_images` |
| Cart | `carts` (guest cart from the `uc_cart` cookie, or a user's cart) · `cart_items` |
| Orders | `orders` · `order_items` (SKU, name and price snapshots) · `payments` (one per provider invoice; `provider` is `qpay` or `storepay`) · `admin_invoices` (orders an admin raised) · `checkout_attempts` (rate limiting) |
| Stock | `inventory_ledger`: one row per stock change, with its reason (`order_paid`, `order_cancelled`, `order_refunded`, `restock`, `manual_adjustment`) |
| Booking | `services` (name, minutes, price) · `availability` (the barber's open windows) · `appointments` (`pending` hold → `booked`, or `cancelled`; `online` or `admin`) |
| Config | `settings`: key/value rows for `shipping_fee`, `shipping_free_threshold` and `booking_fee` |
| Internal | `batch_guards`: always empty; inserting into it aborts a batch (see below) |

Order status lives in `orders.status`; [`orders/state.ts`](src/lib/server/orders/state.ts) enforces the transitions:

```
pending_payment ─┬─▶ paid ─▶ processing ─▶ shipped ─▶ delivered
                 ├─▶ expired
                 └─▶ cancelled
paid · processing · shipped · delivered ─▶ refunded
```

What the database enforces itself:
- Unique keys: `users.email`, `products.slug`, `product_variants.sku`,
  `orders.order_no`, `payments.payment_id`, `appointments.booking_no`, and one
  `cart_items` row per cart and variant.
- Triggers in `drizzle/0001_constraints.sql` that stop `availability` windows
  and live `appointments` from overlapping.

## Rules the code relies on

- **No `db.transaction()`.** D1 has no interactive transactions. Writes that
  must land together go in one `atomic()` batch, and `guard()` re-checks the
  state the batch depends on. A failed guard inserts into `batch_guards`, which
  aborts the whole batch. See [`src/db/atomic.ts`](src/db/atomic.ts).
- **Prices come from the server.** Checkout re-reads `product_variants.price`;
  `cart_items.unit_price_snapshot` only records what the customer was shown.
- **Stock moves when payment settles**, not at checkout, so abandoned carts
  don't take sizes off sale. Every move writes an `inventory_ledger` row.
- **`settleOrder` is the only thing that marks an order paid.** The payment
  callback and the `reconcile` job both call it; `payments_payment_id_key` makes
  sure only one of them wins.
- **Every server function validates its input with zod** and every admin server
  function calls `assertAdmin()`. A server function is a public endpoint, so
  the `/admin` route guard only decides what renders.
- **`cart/cart.ts` exports only server functions and types.** Any other export
  keeps the module in the client bundle, along with the secrets it imports.
  Helpers go in `cart/internal.ts`. See
  [`src/lib/server/README.md`](src/lib/server/README.md).

## Payments

QPay credentials are production credentials, and there is no sandbox. Creating
an invoice moves no money, though: only paying it does. That makes invoice
creation and `payment/check` safe to exercise locally:

```bash
npm run qpay:smoke create 10                 # a real 10₮ invoice
npm run qpay:smoke watch <invoiceId> 10      # poll until paid
npm run qpay:smoke cancel <invoiceId>
```

- **Settlement comes from `payment/check`, never from the callback**, so
  localhost covers everything except the callback route itself.
- **QPay's `expires_in` is a UNIX timestamp, not a duration.**
  `qpay/client.ts` caches the token and lets only one refresh run at a time.
- **E-barimt receipts** are issued only when `QPAY_EBARIMT_INVOICE_CODE` (a
  VAT-enabled QPay invoice code) is set.
- **StorePay** sends the invoice to the customer's app by phone number.

## Booking

Customers choose a service and a free time at `/booking`, then pay the booking
fee by QPay. The paid fee confirms the booking and sends the confirmation
email. An unpaid hold is deleted after 15 minutes. Admins manage bookings at
`/admin/bookings`, `/admin/schedule` and `/admin/services`. They can enter
bookings by hand (a phone call or a walk-in, no fee) and reschedule or cancel
them; a cancelled booking's fee is not refunded. Online booking stays off until
a `booking_fee` is set.

The JSON API is at `/api/v1/public/*` and `/api/v1/admin/*`. Each route file
documents itself; the shared conventions are in
[`src/lib/server/api/README.md`](src/lib/server/api/README.md).

## Scheduled jobs

Cloudflare Cron Triggers on production. Any job can also be run with
`npm run job -- <name>`, or with `POST /api/v1/jobs/<name>` and
`Authorization: Bearer $JOBS_API_TOKEN`. Details are in
[docs/scheduled-jobs.md](docs/scheduled-jobs.md).

| Job | Runs | Does |
|---|---|---|
| `booking-sweep` | every 5 min | Deletes unpaid booking holds past their deadline, after one last QPay check |
| `reconcile` | hourly at :07 | Settles orders whose callback never arrived; cancels and expires lapsed invoices |
| `cleanup` | daily at 03:17 Ulaanbaatar | Deletes expired sessions, OTP codes and guest carts; prunes `checkout_attempts` |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` / `dev:lan` | Dev server (SSR in workerd, local D1); `dev:lan` exposes it on the network |
| `npm run build` / `preview` | Production build to `dist/`; `preview` serves that build |
| `npm run verify` | Everything CI's `verify` job runs |
| `npm test` / `test:unit` / `test:d1` | Vitest. `d1` runs the database code against a real local D1 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration from `schema.ts` |
| `npm run db:migrate[:staging\|:remote]` | Apply migrations locally, to staging or to production |
| `npm run db:studio` / `db:seed` | Drizzle Studio; seed the local catalogue |
| `npm run admin:add -- <email> [name] [--staging\|--remote]` | Make a user an admin |
| `npm run order:inspect -- <orderNo>` | Print a local order and its payments |
| `npm run job -- <name> [--url <base>]` | Run a scheduled job through its endpoint |
| `npm run qpay:ping` / `storepay:ping` | Check provider credentials (read-only) |
| `npm run qpay:smoke` | Create, watch or cancel a real QPay invoice |
| `npm run mail:preview` | Render the receipt email to `receipt-preview.html` |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |

## Layout

```
src/
  server.ts      Worker entry: fetch (TanStack Start) and scheduled (cron)
  db/            schema.ts, the D1 client, atomic.ts
  lib/server/    server-only code by domain (auth, cart, products, orders,
                 payments, booking, admin, email, api); read its README first
  routes/        storefront, /booking, /admin and /api/v1
public/products/ product packshots (.webp)
scripts/         seed, admin, jobs, provider checks, image extraction
drizzle/         generated D1 migrations, committed
```

The product packshots come from the client's Product Bible PDF.
`scripts/extract-brand-images.mjs` converts its CMYK JPEGs, which browsers can't
display, and applies their separate transparency masks.
`scripts/map-brand-images.mjs` copies each one to
`public/products/<slug>.webp`.
