# Uppercut Deluxe Mongolia

E-commerce storefront for the Mongolian Uppercut Deluxe distributor.
TanStack Start (SSR + server functions) on Cloudflare Workers · D1 + Drizzle · QPay.

## Prerequisites

- **Node 22 LTS** — `winget install OpenJS.NodeJS.LTS`

That's all. The database is Cloudflare D1, and locally wrangler runs it as a
SQLite file under `.wrangler/state` — no Docker, no database server. `npm run
dev` runs the server code inside workerd, the same runtime as production.

## First run

```bash
npm install
cp .env.example .dev.vars
```

`.dev.vars` is what wrangler reads for local config (it falls back to `.env`
when there is no `.dev.vars`). The mock values in it boot the app; real
credentials only matter for the integrations you are working on. The two
`VITE_PUBLIC_POSTHOG_*` lines also go in `.env.development.local` — Vite reads
`VITE_*` from `.env*` files only, never from `.dev.vars`.

```bash
npm run db:migrate                       # create the tables in the local D1
npm run db:seed                          # the real catalogue, placeholder prices
npm run admin:add -- you@example.com "Your Name"
npm run dev
```

App on http://localhost:3000. Admin login is an emailed code; without
`RESEND_API_KEY` the code is printed to the dev server's console instead.

Deploying: [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md).

## Product imagery

Packshots are extracted from the client's Product Bible PDF:

```bash
node scripts/extract-brand-images.mjs ~/Downloads/ProductBible-May2026.pdf /tmp/img --sheets
```

Two wrinkles that the script exists to handle: the packshots are **CMYK JPEGs**,
which browsers cannot render at all, and their transparency lives in a separate
`/SMask` stream — without it every product sits on a black rectangle.

`scripts/map-brand-images.mjs` then copies identified images to
`public/products/<slug>.webp`. The mapping is by eye from contact sheets, since
the PDF has no machine-readable link between an image and a product name.

**13 of 22 products have imagery. 9 do not** — clay, clay-spray, control-cream,
texture-cream, salt-spray, foam-tonic, beard-oil, beard-balm, barber-cape. Their
packshots are the CMYK-plus-mask variants the extractor can't yet decode. They
render a text placeholder rather than a wrong photo. Either the mask handling
gets fixed or the client supplies plain product shots.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server, SSR in workerd, HMR, local D1 |
| `npm run build` | Production build to `dist/` (client assets + Worker) |
| `npm run preview` | Build, then serve the built Worker locally |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: `unit` (pure functions) and `d1` (database code on a real local D1) |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to the local D1 (`db:migrate:remote` for the deployed one) |
| `npm run db:studio` | Drizzle Studio on the local D1 |
| `npm run db:seed` | Seed the catalogue into the local D1 |
| `npm run admin:add -- <email> [name] [--remote]` | Grant admin, locally or on the deployed D1 |
| `npm run job -- <name> [--url <base>]` | Trigger a scheduled job through its API endpoint |
| `npm run qpay:ping` | Fetch one QPay token to check credentials. Read-only |

## Cart and checkout

Browse → cart → checkout → QPay → success is wired end to end.

- **Guest cart** keyed by an opaque `uc_cart` cookie. `SameSite=Lax`, not
  `Strict`: QPay sends the customer into a bank app and back, and `Strict`
  would drop the cookie on that return — they would come back from paying to
  an empty cart.
- **Every price is re-read from `product_variants`.** `cart_items.unit_price_snapshot`
  exists so an admin can see what the customer was shown; it is never what they
  are charged. A price change while the cart sat there is visible *before*
  payment, not after.
- **Stock is not held by an unpaid order.** Decrementing at checkout would take
  a size off sale for every abandoned cart. Stock moves when payment settles.
- **`settleOrder` is the only thing that marks an order paid.** The callback
  route and the reconciliation sweep both call it, which is what makes them safe
  to race — `payments_payment_id_key` lets exactly one win.

### The bundling rule this exposed

`src/lib/server/cart/cart.ts` exports **only server functions and types**.
Helpers live in `cart/internal.ts`, which no route may import.

This is not style. A module that exports anything else stays in the client
graph, dragging its imports with it — which briefly put `env` (holding the QPay
password) and the QPay client into the browser bundle. The visible symptom was
`Buffer is not defined` and a dead Add to cart button; the real problem was
handing secrets to the client bundler at all. Verify with:

```bash
npm run build && grep -r "QPAY_PASSWORD" dist/client/
```

## Booking

One barber, one shop. The barber adds his services (a name and a length —
"Haircut, 45 minutes") and opens windows on his schedule, any day and any
hours. A customer picks a service and a free time, enters name, phone and
email, and pays the booking fee through QPay; the paid fee confirms the
booking and the confirmation email goes out. Unpaid holds are deleted after
15 minutes.

Admins see every booking. They can:

- **reschedule** or **cancel** one — the customer is emailed either way, and
  a cancelled booking's fee is kept (non-refundable);
- **enter a booking by hand** (a phone call, a walk-in): booked at once, no
  fee, email optional.

Neither of those is held to the schedule; only overlapping another booking
is refused.

Three tables — `services`, `availability`, `appointments` — and a JSON API,
with no screens in this app: `/api/v1/public/*` for a booking page,
`/api/v1/admin/*` (admin session) for the barber. Each route file documents
itself; conventions are in
[`src/lib/server/api/README.md`](src/lib/server/api/README.md). The booking
fee is a setting (`PUT /api/v1/admin/booking-fee`); until it is set, online
booking is off.

## Admin

`/admin` — dashboard, orders (list, detail, status transitions), products
(list, price/stock/status editing). Desktop-first, since it is used at a desk,
but it collapses to one column so orders can be checked on a phone.

### Signing in

Admins sign in with a one-time code sent to their email (`otp_codes`, then a
`sessions` row) — there is no password and no signup. An account becomes an
admin only through `npm run admin:add`. See [docs/email-otp.md](docs/email-otp.md).

### Two layers of check, on purpose

The `/admin` layout's `beforeLoad` decides what *renders*. Every admin server
function separately calls `assertAdmin()`, because a server function is a public
HTTP endpoint — anyone can call it directly with the right payload, layout or
no layout. The route guard is convenience; `assertAdmin()` is the control.

This is the thing the deleted Go layer used to enforce for free.

## Conventions that are load-bearing

Read [`src/lib/server/README.md`](src/lib/server/README.md) before adding a
server function. The short version:

- **Money is mungu** (₮ × 100), integer columns, integers only, via `~/lib/money`.
  Conversion to tugrik happens at display and at the QPay boundary, nowhere else.
- **Every server function validates input with zod.** There is no second service
  behind this one re-checking anything.
- **Prices are recomputed server-side at checkout.** Client totals are display
  artefacts.
- **Sessions are database rows**, not JWTs. The cookie holds a token; the DB
  holds its SHA-256 hash.
- **No `db.transaction()`.** D1 has no interactive transactions. Writes that
  must land together go through one atomic batch, with `guard()` re-checking
  what a row lock used to protect — see [`src/db/atomic.ts`](src/db/atomic.ts).

## QPay: what the credentials actually are

**These are production credentials. There is no sandbox pair for this
merchant.** Any invoice created against `THREE33_BARBER_INVOICE` is a real,
payable invoice that will appear in the merchant portal. Treat invoice creation
as a live action during development — test with small amounts, and cancel
invoices you don't intend to settle (`cancelInvoice`).

Two things learned from the vendor spec that the code depends on:

- **`expires_in` is a UNIX timestamp, not a duration.** Confirmed live: QPay
  returned `1785815975`. Reading it the OAuth way gives a token we believe is
  valid for ~52 years and therefore never refresh. `resolveExpiry()` handles
  both readings; see `qpay/client.ts`.
- **Do not fetch a token per request.** QPay's integration notes call this out
  explicitly. `QpayClient` caches the token and single-flights refreshes.

### Testing QPay without spending money

**Creating an invoice moves no money.** It mints a QR and a set of bank
deeplinks; you are charged only if someone scans and pays. So invoice creation
and `payment/check` polling are free to exercise against production.

**You also don't need a public callback URL to test settlement.** The callback
is only a hint that it's worth asking; settlement always comes from
`payment/check`, which we call ourselves. That's the same path the
reconciliation sweep uses, so localhost covers everything except testing the
callback route itself (for that, tunnel with `cloudflared tunnel --url
http://localhost:3000` and point `APP_URL` at the tunnel).

```bash
npm run qpay:smoke create 10
```

Creates a 10₮ invoice through the real `QpayProvider`, prints the short URL,
QR and deeplinks, then tells you how to watch or cancel it. Test invoices are
prefixed `TEST-<timestamp>` so they can never collide with a real `order_no` —
which matters, because `sender_invoice_no` is burnt permanently.

```bash
npm run qpay:smoke watch  <invoiceId> 10   # polls until it settles
npm run qpay:smoke cancel <invoiceId>      # throw it away unpaid
```

Verified on 3 Aug 2026: invoice created, 22 bank deeplinks returned,
`payment/check` correctly reported `unpaid`, invoice cancelled cleanly.

Open items with the client, both blocking parts of checkout:

1. **E-barimt.** QPay issues the receipt for us via `POST /v2/ebarimt/create`
   (`payment_id` + `CITIZEN`/`ORGANIZATION`) — we don't integrate with the tax
   authority directly. But that requires a **separate VAT-enabled invoice code**
   from QPay; `THREE33_BARBER_INVOICE` is the plain one. If the business must
   issue e-barimt, request that code now — it changes the invoice payload
   (`lines[]` with `tax_product_code` and VAT amounts).
2. **The merchant name is `THREE33_BARBER`**, not an Uppercut Deluxe entity.
   Confirm this is the intended legal entity for receiving payment before launch.

## Scheduled jobs

Three, run by Cloudflare Cron Triggers (`triggers.crons` in `wrangler.jsonc`,
dispatched by `src/server.ts`) — nothing to set up beyond deploying. Each can
also be triggered over HTTP with a bearer token. Full detail in
[docs/scheduled-jobs.md](docs/scheduled-jobs.md).

| Job | Every | What it does |
|---|---|---|
| `reconcile` | hourly, at :07 | Settles orders whose payment callback never arrived (QPay and StorePay); cancels lapsed invoices with the provider and expires them |
| `booking-sweep` | 5 minutes | Deletes unpaid booking holds past their deadline, after a last QPay check |
| `cleanup` | daily, 03:17 Ulaanbaatar | Deletes expired sessions, OTP codes and guest carts, and prunes `checkout_attempts` |

| Way in | How |
|---|---|
| Cron Triggers | default, once deployed |
| External scheduler / by hand | `POST /api/v1/jobs/<job>` with `Authorization: Bearer $JOBS_API_TOKEN` — or `npm run job -- <job>` |

Dropped callbacks are a when, not an if, and `reconcile` is the only thing that
cancels an abandoned invoice with the provider. If you change how this app is
deployed, check that something is still running it.

## Layout

```
src/
  server.ts      the Worker entry: fetch (TanStack Start) + scheduled (cron)
  db/            schema.ts (single source of truth), the D1 client, atomic.ts
  lib/
    money.ts     mungu arithmetic — the only place ₮ conversion happens
    server/      server-only code, organised by domain; see its README
  routes/        file-based routes; storefront, /admin and /api/v1
  styles/
scripts/         seed, admin, job trigger, provider checks — run outside the Worker
drizzle/         generated D1 migrations (plus hand-written triggers), committed
wrangler.jsonc   the Worker: bindings, cron triggers, vars
```

## Status

Phase 0 (foundations). Next: Phase 1 catalog — products/variants/categories
schema is already in place; admin CRUD, image upload, and the storefront listing
are not.

**QPay merchant onboarding should already be in flight** — it is the long pole,
and Phase 4 stalls without sandbox credentials.
