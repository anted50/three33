# Deploying to Cloudflare Workers

The whole app is one Worker: TanStack Start's SSR and server functions, the
`/api/v1` routes, the static assets in `public/` and the client bundle, plus
three Cron Triggers. The database is Cloudflare D1. Configuration lives in
[`wrangler.jsonc`](../wrangler.jsonc).

## What it is made of

| Concern | Locally (`npm run dev`) | Deployed |
|---|---|---|
| Server runtime | workerd, via `@cloudflare/vite-plugin` | Cloudflare Workers — the same runtime |
| Database | D1 as a SQLite file in `.wrangler/state` | **D1**, bound as `DB` |
| Static files | served by Vite | Workers static assets (`public/` + the hashed bundle) |
| Scheduled jobs | `/cdn-cgi/handler/scheduled?cron=…` to fire one | **Cron Triggers**, see below |
| Config | `.dev.vars` (else `.env`) | `vars` in wrangler.jsonc + **secrets** |
| Object storage | none — images are static files in `public/` | still none |

## First deploy

The order matters. Cloudflare runs the Worker's startup code when it is
uploaded, and the Worker refuses to start without its required secrets
(`src/lib/server/env.ts`) — so the secrets go in **before** the first
deploy, or the upload is rejected with "Invalid environment configuration".

```bash
npx wrangler login

# 1. secrets — the first `secret put` offers to create the Worker; say yes
npx wrangler secret put QPAY_USERNAME
npx wrangler secret put QPAY_PASSWORD
npx wrangler secret put QPAY_INVOICE_CODE
npx wrangler secret put QPAY_CALLBACK_SECRET     # openssl rand -base64 48
npx wrangler secret put RESEND_API_KEY           # for any email at all
npx wrangler secret put JOBS_API_TOKEN           # openssl rand -hex 32, optional

# 2. the code
npm run deploy

# 3. the tables
npm run db:migrate:remote

# 4. the first admin, so someone can sign in
npm run admin:add -- you@three33barber.com "Your Name" --remote
```

The D1 database already exists (`database_id` in `wrangler.jsonc`). On a
brand-new account, leaving `database_id` out makes the first deploy create
it — then copy the id from `npx wrangler d1 list` into `wrangler.jsonc` and
commit it, or the next deploy from another machine creates a second, empty
database.

The Worker answers on `https://three33.<your-subdomain>.workers.dev`. Set
`APP_URL` in `wrangler.jsonc` `vars` to that address (or the custom domain,
once attached — see below) and deploy again.

The database starts **empty**: no products, no categories, no orders. That
is the intended state for now — data comes later, from an import into D1.
`npm run db:seed` only ever writes to the local D1.

## Configuration

Non-secret values are in `wrangler.jsonc` under `vars`, committed:

```
NODE_ENV=production
APP_URL=https://<your workers.dev host or custom domain>
QPAY_BASE_URL=https://merchant.qpay.mn/v2
EMAIL_FROM=Three33 Barbershop <noreply@three33barber.com>
```

Secrets are set with `npx wrangler secret put NAME` and never committed:

| Secret | Required | Notes |
|---|---|---|
| `QPAY_USERNAME`, `QPAY_PASSWORD`, `QPAY_INVOICE_CODE` | yes | production credentials — there is no QPay sandbox |
| `QPAY_CALLBACK_SECRET` | yes | ≥ 32 chars; signs our callback URLs |
| `RESEND_API_KEY` | for email | unset = no receipts and no admin login codes, silently |
| `JOBS_API_TOKEN` | no | ≥ 32 chars; enables `POST /api/v1/jobs/*` |
| `QPAY_EBARIMT_INVOICE_CODE` | no | VAT-enabled invoice code, requested from QPay |
| `STOREPAY_*` (all seven) | no | StorePay appears at checkout only when every one is set |
| `MONTHLY_ORDER_GOAL` | no | admin dashboard target, default 100 (a plain var is fine) |

The full list with explanations is [`.env.example`](../.env.example).

**`VITE_PUBLIC_POSTHOG_*` are build-time, not runtime.** Vite bakes them into
the client bundle when `npm run deploy` builds, from the build machine's
environment or `.env` — setting them as Worker vars or secrets does nothing
for the browser. Build from a machine (or CI job) that has them.

`APP_URL` matters more than it looks: it builds the QPay callback URL. Point it
at the wrong host and payments still settle — the payment page polls
`payment/check` — but the callback never arrives and every order waits on the
hourly sweep instead. It also builds the receipt email's "view order" link.

`EMAIL_FROM` must be an address on a domain verified in Resend (SPF/DKIM);
Resend rejects an unverified sender outright (`Resend send failed (403)`).

## Custom domain

Attach `three33barber.com` to the Worker in the Cloudflare dashboard (Workers
& Pages → three33 → Settings → Domains & Routes), or with a `routes` entry in
`wrangler.jsonc`. Then set `APP_URL` to it and deploy.

## Scheduled jobs

`triggers.crons` in `wrangler.jsonc` schedules them; `scheduled()` in
`src/server.ts` maps each expression to a job. Deploying is enough — there is
nothing else to create. Runs show up under the Worker's Logs (observability is
on) as `scheduled_job_finished` lines, and a failed run is marked failed in the
dashboard. See [scheduled-jobs.md](./scheduled-jobs.md).

## Migrations

```bash
npm run db:generate          # after editing src/db/schema.ts
npm run db:migrate           # local
npm run db:migrate:remote    # deployed — run before deploying code that needs it
```

wrangler records applied migrations in the `d1_migrations` table, so both are
safe to re-run. Unlike the old Railway setup there is no pre-deploy hook:
apply remote migrations yourself, before `npm run deploy`, whenever the schema
changed.

## Things that are different from Postgres

D1 is SQLite. The code is written around three differences — read
[`src/db/atomic.ts`](../src/db/atomic.ts) before writing to the database:

- **No interactive transactions.** `db.transaction()` must never be called; D1
  rejects `BEGIN`. Writes that must land together go in one `atomic([...])`
  batch.
- **No row locks.** What `SELECT … FOR UPDATE` used to protect is re-checked
  inside the batch with `guard()`, which aborts the batch with an error code.
- **No EXCLUDE constraints.** Overlapping appointments and shifts are refused
  by triggers (`drizzle/0001_constraints.sql`), with the same error codes.

Case-insensitive matching (`LIKE`, `lower()`) is ASCII-only in SQLite, which is
why product search matches in JS — see `src/lib/server/products/queries.ts`.

## Limits worth knowing

- **Bundle size.** The Worker uploads at ~0.9 MB gzipped (`wrangler deploy
  --dry-run` shows it); the free plan allows 3 MB, paid 10 MB. Most of it is
  exceljs, loaded only for the admin's order export.
- **Request time.** A request has no wall-clock limit while it is waiting on
  I/O, but CPU time is capped (30 s by default on paid). The jobs are I/O-bound
  and well inside it.
- **D1 size.** 10 GB per database on paid plans — far beyond this shop.
