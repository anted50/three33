# Scheduled jobs

Everything in this project that runs on a clock. If it is not in this table, it
is not scheduled.

| Job | Cron (UTC) | Runs | HTTP trigger | Work lives in |
|---|---|---|---|---|
| `reconcile` | `7 * * * *` | hourly, at :07 | `POST /api/v1/jobs/reconcile` | `src/lib/server/orders/reconcile.ts` |
| `booking-sweep` | `*/5 * * * *` | every 5 minutes | `POST /api/v1/jobs/booking-sweep` | `src/lib/server/booking/sweep.ts` |
| `cleanup` | `17 19 * * *` | daily, 03:17 Ulaanbaatar | `POST /api/v1/jobs/cleanup` | `src/lib/server/maintenance.ts` |

Each job has two ways in, both calling the same function through `runJob`
(`src/lib/server/jobs.ts`):

1. **Cloudflare Cron Triggers** (default). `triggers.crons` in
   `wrangler.jsonc` schedules them; `scheduled()` in `src/server.ts` maps each
   expression to a job through its `CRON_JOBS` table. Deploying the Worker is
   all it takes.
2. **HTTP, with a bearer token** — for an external scheduler, or by hand with
   `npm run job -- <name>` (add `--url https://…` for a deployed Worker). See
   [Triggering from outside](#triggering-from-outside).

There is no `pg_cron`, no cron service and no long-running process: a Worker
only runs when something invokes it, and the Cron Triggers are what invoke it
on a clock.

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
| 409 `JOB_RUNNING` | this isolate is already running that job; try next tick |
| 500 `JOB_FAILED` | ran, but some order/hold/table failed — tally in `error.details` |
| 503 `JOBS_API_DISABLED` | `JOBS_API_TOKEN` is not set on the server |

A job runs inline in the request, and the request stays open until it
finishes — usually well under a second, but `reconcile` can check up to 500
orders against the payment providers, so give a scheduler a generous timeout
(a few minutes). Every route file (`src/routes/api.v1.jobs.*.ts`) documents its
own result shape.

## How a cron run works

Cloudflare invokes the Worker's `scheduled()` handler with the cron
expression that fired. The handler looks the job up in `CRON_JOBS`, runs it
through `runJob` inside `ctx.waitUntil`, and logs a
`scheduled_job_finished` line (Workers Logs — observability is on in
`wrangler.jsonc`).

- A failed run is **rethrown**, so the invocation shows as failed in the
  dashboard's Cron Events.
- A job still running from its previous tick (in the same isolate) is skipped
  with a warning, not stacked.
- An expression with no entry in `CRON_JOBS` is logged as an error and does
  nothing. Edit `triggers.crons` and `CRON_JOBS` together.

Locally, `npm run dev` exposes the handler at
`/cdn-cgi/handler/scheduled?cron=<expression>` (spaces as `+`), e.g.
`curl "localhost:3000/cdn-cgi/handler/scheduled?cron=17+19+*+*+*"`.

## Running more than once at a time is safe

A cron tick plus an external scheduler, two isolates, or a scheduler that
retries on timeout can all end up running the same job at once. That needs no
coordination:

- `reconcile` settles through `settleOrder`, which is built to be raced: its
  D1 batch starts with a guard that the order is still `pending_payment`, and
  the unique index `payments_payment_id_key` backs it up, so exactly one
  settlement lands no matter how many callers arrive at once. It is the same
  guarantee that makes the sweep safe alongside a live payment callback.
- `booking-sweep` guards every confirmation with `status = 'pending'`.
- `cleanup` is idempotent `DELETE`s over expired rows.

The cost of overlap is duplicate provider calls (QPay `payment/check`,
StorePay loan checks), not duplicate payments. `runJob` refuses a second
concurrent run *in the same isolate* (409 over HTTP, a skipped tick for cron);
it does not coordinate across isolates, and does not need to.

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

In `src/lib/server/booking/sweep.ts`. **Unpaid booking holds are deleted.**
A booking is only a hold until its fee is paid; past `expires_at` the sweep
asks QPay one last time (a last-second payment still confirms the booking),
cancels the invoice, and only then deletes the hold. If QPay won't cancel,
the hold stays for the next run, so a payment can never land with nothing to
match it.

Frequent because a hold blocks a real time from other customers. Cheap when
there is nothing to do — one indexed select and no QPay call.

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

## Changing a schedule

Edit `triggers.crons` in `wrangler.jsonc` **and** `CRON_JOBS` in
`src/server.ts` — Cloudflare hands back the exact expression, so the two must
match character for character — then update the table at the top of this file
and deploy.

## Adding a job

1. Put the work in a function under `src/lib/server/<domain>/`.
2. Register it in `src/lib/server/jobs.ts` and add
   `src/routes/api.v1.jobs.<name>.ts`.
3. Add its expression to `triggers.crons` in `wrangler.jsonc` and to
   `CRON_JOBS` in `src/server.ts`, and its row to the table above.
4. Add it to the list in `scripts/run-job.ts`.
