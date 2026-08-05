# Deploying to Railway

## What changes

| Concern | Local now | Railway |
|---|---|---|
| Database | PGlite in `.pglite/` | **Railway Postgres** — add the plugin, it injects `DATABASE_URL` |
| Object storage | none — images are static files in `public/` | **still none needed**, see below |
| QPay callbacks | unreachable (`localhost`) | **finally work** — set `APP_URL` to the Railway domain |
| Admin gate | shared token | **refuses to run** unless `ALLOW_TEMP_ADMIN=true` |
| Reconciliation sweep | manual | needs a **cron service** |

## Database — solved by deploying

Add Railway's Postgres plugin. It injects `DATABASE_URL`, and `src/db/index.ts`
already picks the postgres driver whenever that variable is present.

Set `DB_DRIVER=postgres` explicitly anyway, so an empty `DATABASE_URL` fails
loudly instead of silently falling back to PGlite and serving an empty
catalogue from a container's ephemeral disk.

This also retires the local PGlite problems — the corruption, the guard in
`src/lib/server/pglite-guard.ts`, and the dev-server restart dance. Consider
pointing local development at a second Railway Postgres, or a free Neon
database, and dropping PGlite entirely.

**Migrations** must run before the new release serves traffic. Railway calls
this a *pre-deploy command*:

```
npm run db:migrate
```

It is safe to re-run; drizzle records what it has applied.

**The catalogue needs seeding once**, against the production database:

```
npm run db:seed
```

Idempotent, so a second run changes nothing.

## Object storage — not needed yet

There is no object storage anywhere in this project — no bucket, no
credentials, no MinIO service, no `S3_*` variables. Product images are static
`.webp` files committed under `public/products/` and served by the app. All 22
come to under a megabyte, so a bucket and its failure modes bought nothing.

Storage becomes necessary when admin image upload lands, because a container's
filesystem does not survive a redeploy — an uploaded image would vanish on the
next push. At that point use **Cloudflare R2**: S3-compatible, so the planned
client works unchanged, and no egress fees. Railway volumes are the other
option but tie images to one service instance.

## Environment variables

Set these in Railway. `.env` is gitignored and does not deploy.

**Required**

```
NODE_ENV=production
APP_URL=https://<your-railway-domain>
DB_DRIVER=postgres
DATABASE_URL=<injected by the Postgres plugin>
SESSION_SECRET=<openssl rand -base64 48>
QPAY_BASE_URL=https://merchant.qpay.mn/v2
QPAY_USERNAME=THREE33_BARBER
QPAY_PASSWORD=<rotate this before launch>
QPAY_INVOICE_CODE=THREE33_BARBER_INVOICE
QPAY_CALLBACK_SECRET=<openssl rand -base64 48>
SHIPPING_FEE_UB=500000
SHIPPING_FEE_COUNTRYSIDE=1500000
```

**Optional**

```
ADMIN_TOKEN=<16+ chars>
ALLOW_TEMP_ADMIN=true     # see below
MONTHLY_ORDER_GOAL=100
SENTRY_DSN=
```

`APP_URL` matters more than it looks: it builds the QPay callback URL. Point it
at the wrong host and payments still settle — the payment page polls
`payment/check` — but the callback never arrives and every order waits on the
hourly sweep instead.

## Admin will refuse to start on production

By design. The shared-token gate declines to work when `NODE_ENV=production`
unless `ALLOW_TEMP_ADMIN=true` is set explicitly, because it has no per-user
identity and no audit trail of who changed a price or cancelled an order.

Either set that variable and accept the tradeoff for now, or finish email OTP
login first — see `docs/email-otp.md`.

## The reconciliation sweep needs its own service

`npm run reconcile` catches orders whose QPay callback never arrived. It cannot
live in the app: server functions only run when a request arrives, and the
whole point is the case where no request ever came.

Add a second Railway service from the same repo, with a cron schedule of
`0 * * * *` and start command `npm run reconcile`. Do not skip this — dropped
callbacks are a when, not an if.

## Build and start

Railway auto-detects Node and runs `npm run build` then `npm start`.

Both scripts exist and are load-bearing:

- **`npm run build`** runs `scripts/build.mjs`, not `vite build` directly.
  `NODE_ENV=production` must be set before `@vitejs/plugin-react` is imported,
  and it uses `createBuilder().buildApp()` because the app has two Vite
  environments and the plain `build()` API only builds one. Getting either
  wrong produces a build that reports success and then 500s on every page.
- **`npm start`** runs `server/index.mjs`. The Vite build emits a `fetch`
  handler that listens on nothing; that file is the actual HTTP server, and it
  binds `0.0.0.0` on `PORT`.

Verified locally against the production build: every route 200s, `/admin`
redirects to unlock, static assets serve with immutable caching.

## Known wart

`@electric-sql/pglite` is a production dependency and weighs 25 MB, despite
being unused once `DB_DRIVER=postgres`. `src/db/index.ts` imports it statically
so the `db` export can stay synchronous. Worth converting to a lazy import if
build times become annoying.
