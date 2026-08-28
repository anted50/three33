# Scheduled jobs

Everything in this project that runs on a clock. If it is not in this table, it
is not scheduled.

| Job | Runs | Every | First run | Entry point |
|---|---|---|---|---|
| `reconcile` | in the server process | 1 hour | 5 min after boot | `scripts/reconcile.ts` |
| `cleanup` | in the server process | 24 hours | 10 min after boot | `scripts/cleanup.ts` |

**There is no external cron, no cron service, and no `pg_cron`.** Deploying this
app is enough to make both jobs run. Nothing needs to be set up on the host.

The scheduler is `startScheduledJobs()` in `server/index.mjs`, started once the
HTTP listener is up. That file's `JOBS` array is the source of truth for the
timings above.

## How they run

Each job is spawned as a short-lived child process (`node --import tsx <script>`),
not executed inline. Three reasons:

- A job that throws, hangs or leaks cannot take the web server down with it.
- It gets its own database connection, which closes when the process exits,
  instead of holding one from the server's pool for the duration.
- The same file is runnable by hand — `npm run reconcile`, `npm run cleanup` —
  so there is one code path, not a scheduled one and a manual one that drift.

A job that is still running when its next tick arrives is skipped, with a
warning, rather than started twice.

`tsx` is a **runtime** dependency, not a dev dependency, specifically so this
works in production. Do not move it to `devDependencies`.

## Multiple replicas are safe

If the app runs on more than one instance, every instance runs both jobs. This
is deliberate and does not need coordination:

- `reconcile` settles through `settleOrder`, which is built to be raced — the
  partial unique index `payments_qpay_payment_id_key` lets exactly one
  settlement land no matter how many callers arrive at once. It is the same
  guarantee that makes the sweep safe alongside a live QPay callback.
- `cleanup` is idempotent `DELETE`s over expired rows.

The cost of a second replica is duplicated QPay `payment/check` calls, not
duplicated payments.

## `reconcile` — hourly

The safety net under the payment flow. For each `pending_payment` order older
than 10 minutes:

1. Asks QPay `payment/check`. If it was paid, settles it — status, stock,
   inventory ledger, receipt e-mail, and clearing the customer's cart.
2. If it is past `orders.expires_at` (2 hours from checkout) and still unpaid,
   **cancels the invoice at QPay** and marks the order `expired`.

Step 2 is the half that cannot be skipped. Marking an order expired on our side
does nothing to the invoice — without the cancellation it stays payable, and a
customer paying it days later puts real money against an order nobody will ever
ship.

Most orders never reach this job: the customer's own payment page polls, and
QPay's callback usually arrives. This catches dropped callbacks, closed tabs,
and exhausted QPay retries.

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
`reconcile` is three outbound HTTPS calls (QPay `/payment/check`, QPay invoice
cancellation, and the receipt e-mail through ZeptoMail). Moving it into
PL/pgSQL would mean reimplementing the settlement path, including its OAuth
token handling and response validation, in the one language in this project
that has no unit tests.

The four `cleanup` deletes *would* have fitted `pg_cron` perfectly. They stayed
here so that there is one place to look, and because `pg_cron` needs
`shared_preload_libraries`, a Postgres restart, and superuser to install —
infrastructure this app otherwise does not require.

## Changing a schedule

Edit the `JOBS` array in `server/index.mjs` and update the table at the top of
this file. Both, or this document stops being true.
