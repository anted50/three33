# Uppercut Deluxe Mongolia

E-commerce storefront for the Mongolian Uppercut Deluxe distributor.
TanStack Start (SSR + server functions, one deploy) · PostgreSQL + Drizzle · QPay.

## Prerequisites

- **Node 22 LTS** — `winget install OpenJS.NodeJS.LTS`
- **Docker Desktop** — `winget install Docker.DockerDesktop` (needs WSL2 + a reboot)

Both must be on `PATH`; open a new terminal after installing.

## First run

```bash
cp .env.example .env
```

Then fill in `SESSION_SECRET` and `QPAY_CALLBACK_SECRET` with long random values
(`openssl rand -base64 48`). The app refuses to boot on a short or missing
secret — see `src/lib/server/env.ts`.

```bash
docker compose up -d
```

Starts Postgres on 5432 and MinIO on 9000 (console 9001, `minioadmin` /
`minioadmin`). The `minio-init` container creates the `uppercut-media` bucket
and exits — that's expected, not a crash.

```bash
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

App on http://localhost:3000. The homepage renders the database's current time,
which is the Phase 0 proof that route → loader → server function → Drizzle →
Postgres works end to end.

### Running without Docker

Docker isn't installed on the current dev machine, so `DB_DRIVER=pglite` in
`.env` runs Postgres in-process against `.pglite/`. Same engine, same SQL, same
migrations — `DB_DRIVER=postgres` switches to Compose whenever it's available.

**Stop the dev server before running `db:migrate` or `db:seed`.** PGlite is a
single-writer embedded database. Two processes on the same directory do not
fail cleanly — they corrupt it, and the next read aborts inside the WASM runtime
with a stack trace that says nothing about the cause. That happened here once;
the fix was `rm -rf .pglite` and re-running migrate + seed.

`src/lib/server/pglite-guard.ts` now makes the scripts refuse to start while
something is listening on port 3000, so the failure is a clear message instead
of a corrupted database. It no-ops under `DB_DRIVER=postgres`.

**This is the main argument for getting Docker up.** PGlite was a stopgap so
work could start without it; the single-writer limit costs a dev-server restart
on every schema or seed change, and it has already eaten a database once.
Compose Postgres has none of these problems.

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
| `npm run dev` | Vite dev server, SSR + HMR |
| `npm run build` | Production build to `.output/` |
| `npm start` | Run the built server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — pricing, money, cookies, order state, QPay callback |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run reconcile` | The QPay reconciliation sweep (see below) |
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
  to race — `payments_qpay_payment_id_key` lets exactly one win.

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

## Admin

`/admin` — dashboard, orders (list, detail, status transitions), products
(list, price/stock/status editing). Desktop-first, since it is used at a desk,
but it collapses to one column so orders can be checked on a phone.

### The gate is temporary and deliberately awkward

`ADMIN_TOKEN` is a **shared password, not authentication**. No per-user
identity, no audit trail of who changed what, no revocation short of rotating
it for everyone. It exists so admin is usable before Phase 2 auth lands.

Two guards stop it becoming permanent by accident:

- No `ADMIN_TOKEN` set → the admin section does not exist.
- In production it **refuses to work** unless `ALLOW_TEMP_ADMIN=true`. Shipping
  a shared password should take a deliberate act.

When real auth lands, delete `admin/gate-internal.ts` and `admin/gate.ts` and
switch to `users.role === 'admin'`. Do not keep this as a fallback.

### Two layers of check, on purpose

The `/admin` layout's `beforeLoad` decides what *renders*. Every admin server
function separately calls `assertAdmin()`, because a server function is a public
HTTP endpoint — anyone can call it directly with the right payload, layout or
no layout. The route guard is convenience; `assertAdmin()` is the control.

This is the thing the deleted Go layer used to enforce for free.

## Conventions that are load-bearing

Read [`src/lib/server/README.md`](src/lib/server/README.md) before adding a
server function. The short version:

- **Money is mungu** (₮ × 100), `BIGINT`, integers only, via `~/lib/money`.
  Conversion to tugrik happens at display and at the QPay boundary, nowhere else.
- **Every server function validates input with zod.** There is no second service
  behind this one re-checking anything.
- **Prices are recomputed server-side at checkout.** Client totals are display
  artefacts.
- **Sessions are database rows**, not JWTs. The cookie holds a token; the DB
  holds its SHA-256 hash.

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

## The one thing that lives outside the app

`npm run reconcile` is a standalone script, not a server function — server
functions only run when a request arrives, and the whole point of the sweep is
to catch orders where the QPay callback never did.

Runs hourly. Finds `pending_payment` orders older than 10 minutes, calls QPay
`payment/check` for each, and settles or expires them. Host cron:

```
0 * * * * cd /srv/uppercut && npm run reconcile >> /var/log/uppercut-reconcile.log 2>&1
```

Do not skip this. Dropped callbacks are a when, not an if.

## Layout

```
src/
  db/            schema.ts (single source of truth) + connection
  lib/
    money.ts     mungu arithmetic — the only place ₮ conversion happens
    server/      server-only code, organised by domain; see its README
  routes/        file-based routes; storefront + /admin
  styles/
scripts/         seed + reconcile — run outside the request cycle
drizzle/         generated migrations, committed
```

## Status

Phase 0 (foundations). Next: Phase 1 catalog — products/variants/categories
schema is already in place; admin CRUD, image upload, and the storefront listing
are not.

**QPay merchant onboarding should already be in flight** — it is the long pole,
and Phase 4 stalls without sandbox credentials.
