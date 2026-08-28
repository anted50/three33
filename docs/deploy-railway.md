# Deploying to Railway

## What changes

| Concern | Local now | Railway |
|---|---|---|
| Database | PGlite in `.pglite/` | **Railway Postgres** — add the plugin, it injects `DATABASE_URL` |
| Object storage | none — images are static files in `public/` | **still none needed**, see below |
| QPay callbacks | unreachable (`localhost`) | **finally work** — set `APP_URL` to the Railway domain |
| Admin login | email OTP | **works as-is** — just needs `MAIL_API_TOKEN` and an admin granted via `npm run admin:add` |
| Scheduled jobs | automatic | run by the app process, nothing to set up |

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
QPAY_BASE_URL=https://merchant.qpay.mn/v2
QPAY_USERNAME=THREE33_BARBER
QPAY_PASSWORD=<rotate this before launch>
QPAY_INVOICE_CODE=THREE33_BARBER_INVOICE
QPAY_CALLBACK_SECRET=<openssl rand -base64 48>
MAIL_API_TOKEN=<full "Zoho-enczapikey ..." value from ZeptoMail>
```

Admin login (email OTP) needs `MAIL_API_TOKEN` to actually send the code — see
below.

**Optional**

```
MONTHLY_ORDER_GOAL=100
SENTRY_DSN=
QPAY_EBARIMT_INVOICE_CODE=<VAT-enabled invoice code, requested from QPay>
```

`APP_URL` matters more than it looks: it builds the QPay callback URL. Point it
at the wrong host and payments still settle — the payment page polls
`payment/check` — but the callback never arrives and every order waits on the
hourly sweep instead. It also builds the receipt email's "view order" link and
the logo image URL, so a stale `APP_URL` here shows up as a broken image and a
dead link in the email, not as an error anywhere.

`MAIL_API_TOKEN` unset is not an error either — `sendEmail()` returns `false`
silently, by design, so a receipt just never arrives with nothing in the logs
to explain why. `.env` never deploys, so this one is easy to set locally and
forget to set on the actual host.

## Admin login

Real per-user auth, not a shared password: `/admin/login` emails a 6-digit
code via ZeptoMail to any address that belongs to a `users` row with
`role = 'admin'`. No signup form exists — an OTP only ever logs someone into
an account that already exists.

Grant the first (and every later) admin from a shell with access to the
production database:

```
npm run admin:add you@three33barber.com "Your Name"
```

Safe to re-run; it promotes an existing user to admin if the email already
exists, or creates one if it doesn't.

## Scheduled jobs need nothing

The reconciliation sweep and the daily cleanup are run by the app process
itself, on a timer started once the HTTP listener is up. There is no second
service to create and no cron to configure — deploying is enough.

See [scheduled-jobs.md](./scheduled-jobs.md) for what runs and when.

Two things to keep true, though:

- `tsx` must stay in `dependencies`. The jobs are TypeScript run out of
  `scripts/`, and moving `tsx` to `devDependencies` would leave them unable to
  start in a production install.
- Scaling to more than one replica is safe — every instance runs both jobs, and
  `settleOrder` is built to be raced. It costs duplicate QPay `payment/check`
  calls, not duplicate payments.

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
redirects to `/admin/login`, static assets serve with immutable caching.

## Known wart

`@electric-sql/pglite` is a production dependency and weighs 25 MB, despite
being unused once `DB_DRIVER=postgres`. `src/db/index.ts` imports it statically
so the `db` export can stay synchronous. Worth converting to a lazy import if
build times become annoying.
