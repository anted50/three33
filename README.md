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
single-writer embedded database: the dev server holds the directory open, and a
script that writes to it concurrently will appear to succeed while the running
app keeps serving the data it already had. If a seed "worked" but the site still
shows the old catalogue, this is why — restart `npm run dev`. The Compose
Postgres has no such constraint.

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
