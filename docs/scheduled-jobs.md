# Scheduled jobs

Everything in this project that runs on a clock. If it is not in this table, it
is not scheduled.

| Job | Every | First run | Script (`npm run …`) | HTTP trigger | Work lives in |
|---|---|---|---|---|---|
| `reconcile` | 1 hour | 5 min after boot | `reconcile` | `POST /api/v1/jobs/reconcile` | `src/lib/server/orders/reconcile.ts` |
| `booking-sweep` | 5 minutes | 2 min after boot | `booking:sweep` | `POST /api/v1/jobs/booking-sweep` | `src/lib/server/booking/sweep.ts` |
| `cleanup` | 24 hours | 10 min after boot | `cleanup` | `POST /api/v1/jobs/cleanup` | `src/lib/server/maintenance.ts` |

Each job has three ways in, all calling the same function:

1. **The server's own timers** (default). `startScheduledJobs()` in
   `server/index.mjs` starts them once the HTTP listener is up; that file's
   `JOBS` array is the source of truth for the timings above.
2. **An external scheduler over HTTP**, with a bearer token. See
   [Triggering from outside](#triggering-from-outside).
3. **By hand** — `npm run reconcile`, `npm run booking:sweep`,
   `npm run cleanup`. The `scripts/*.ts` files are thin wrappers that exit 1
   if any part of the run failed.

There is no `pg_cron` and no cron service in the repo. Out of the box,
deploying the app is enough for all three jobs to run.

## Triggering from outside

Set `JOBS_API_TOKEN` (at least 32 characters, e.g. `openssl rand -hex 32`) and
call:

```bash
curl -fsS -X POST -H "Authorization: Bearer $JOBS_API_TOKEN" \
  https://three33barber.com/api/v1/jobs/reconcile
```

| Status | Meaning |
|---|---|
| 200 | `{ job, durationMs, result }` — `result` is the job's tally |
| 401 `UNAUTHORIZED` | missing or wrong token |
| 409 `JOB_RUNNING` | this instance is already running that job; try next tick |
| 500 `JOB_FAILED` | ran, but some order/hold/table failed — tally in `error.details` |
| 503 `JOBS_API_DISABLED` | `JOBS_API_TOKEN` is not set on the server |

Over HTTP the job runs **inline in the web process** and the request stays open
until it finishes — usually well under a second, but `reconcile` can check up
to 500 orders against the payment providers, so give the scheduler a generous
timeout (a few minutes). Every route file (`src/routes/api.v1.jobs.*.ts`)
documents its own result shape.

Once something external calls these on schedule, set `SCHEDULED_JOBS=off` so
the in-process timers stand down. Leaving both on is safe (see below), just
redundant. **Do not turn the timers off before the external schedule is
live** — nothing else cancels abandoned invoices.

## How the timers run them

Each tick spawns a short-lived child process (`node --import tsx <script>`),
not inline. Three reasons:

- A job that throws, hangs or leaks cannot take the web server down with it.
- It gets its own database connection, which closes when the process exits,
  instead of holding one from the server's pool for the duration.
- The child runs the same `scripts/*.ts` you run by hand, so there is one code
  path, not a scheduled one and a manual one that drift.

A job that is still running when its next tick arrives is skipped, with a
warning, rather than started twice. Each finished run is logged to PostHog as
`scheduled_job_finished`.

`tsx` is a **runtime** dependency, not a dev dependency, specifically so this
works in production. Do not move it to `devDependencies`.

## Running more than once at a time is safe

Several replicas, the timers plus an external scheduler, or a scheduler that
retries on timeout can all end up running the same job at once. That needs no
coordination:

- `reconcile` settles through `settleOrder`, which is built to be raced — the
  unique index `payments_payment_id_key` lets exactly one settlement land no
  matter how many callers arrive at once. It is the same guarantee that makes
  the sweep safe alongside a live payment callback.
- `booking-sweep` guards every confirmation with `status = 'pending'`.
- `cleanup` is idempotent `DELETE`s over expired rows.

The cost of overlap is duplicate provider calls (QPay `payment/check`,
StorePay loan checks), not duplicate payments. The HTTP endpoints refuse a
second concurrent run *on the same instance* with 409, which is enough to stop
a retrying scheduler from stacking runs; they do not coordinate across
replicas.

## `reconcile` — hourly

The safety net under the payment flow, for every provider (QPay and StorePay).
For each `pending_payment` order older than 10 minutes:

1. Asks the order's payment provider whether it was paid. If it was, settles
   it — status, stock, inventory ledger, receipt e-mail, and clearing the
   customer's cart.
2. If it is past `orders.expires_at` (2 hours from checkout) and still unpaid,
   **cancels the invoice with the provider** and marks the order `expired`.

Step 2 is the half that cannot be skipped. Marking an order expired on our side
does nothing to the invoice — without the cancellation it stays payable, and a
customer paying it days later puts real money against an order nobody will ever
ship.

Most orders never reach this job: the customer's own payment page polls, and
the provider's callback usually arrives. This catches dropped callbacks, closed
tabs, and exhausted provider retries.

## `booking-sweep` — every 5 minutes

Two jobs, both in `src/lib/server/booking/sweep.ts`:

- **Unpaid booking holds are deleted.** An online booking is only a hold
  until its fee is paid; past `expires_at` the sweep asks QPay one last time
  (a last-second payment still confirms the booking), cancels the invoice, and
  only then deletes the hold. If QPay won't cancel, the hold stays for the next
  run, so a payment can never land with nothing to match it.
- **Stranded POS QPay payments are checked.** A barber who closes the screen
  before QPay's callback arrives would leave a paid payment `pending`. After
  five minutes the sweep asks QPay; after a day unpaid it withdraws the
  invoice and marks the payment failed.

Frequent because a hold blocks a real slot from other customers. Cheap when
there is nothing to do — two indexed selects and no QPay call.

## `cleanup` — daily

Four deletes, defined in `src/lib/server/maintenance.ts`. Each runs
independently; one failing does not skip the others.

| Table | Deletes |
|---|---|
| `sessions` | rows past `expires_at` |
| `otp_codes` | rows past `expires_at` |
| `carts` | rows past `expires_at` (30 days); `cart_items` cascades |
| `checkout_attempts` | rows older than 7 days |

None of this is load-bearing. Expiry is enforced where rows are *read*, by
comparing `expires_at` — not by the row being absent. Missing a night costs
disk, not correctness. That is why it is daily and `reconcile` is hourly.

The 7-day window on `checkout_attempts` is not for the rate limiter, which only
ever counts the last hour (`src/lib/server/orders/rate-limit.ts`). It is for the
person looking into a burst of junk orders days after the shop noticed them.

## Why not `pg_cron`

It was considered. `pg_cron` runs SQL, and Postgres has no network stack — but
`reconcile` is outbound HTTPS calls (the provider's payment check, invoice
cancellation, and the receipt e-mail through Resend). Moving it into PL/pgSQL
would mean reimplementing the settlement path, including its OAuth token
handling and response validation, in the one language in this project that
has no unit tests.

The four `cleanup` deletes *would* have fitted `pg_cron` perfectly. They stayed
here so that there is one place to look, and because `pg_cron` needs
`shared_preload_libraries`, a Postgres restart, and superuser to install —
infrastructure this app otherwise does not require.

## Changing a schedule

For the in-process timers: edit the `JOBS` array in `server/index.mjs` and
update the table at the top of this file. Both, or this document stops being
true. If an external scheduler drives the jobs, its schedule is the one that
counts — keep the table in step with it.

## Adding a job

1. Put the work in a function under `src/lib/server/<domain>/`.
2. Add a `scripts/<name>.ts` wrapper and an `npm run` entry.
3. Register it in `src/lib/server/jobs.ts` and add
   `src/routes/api.v1.jobs.<name>.ts`.
4. Add it to `JOBS` in `server/index.mjs` and to the table above.
