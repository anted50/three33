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
