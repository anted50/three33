# `/api/v1` — the booking API

JSON over HTTP, one small route file per resource in `src/routes/api.v1.*.ts`.
Each route file documents its own endpoints at the top: method, path, auth,
body, responses, error codes. Read those first; this file only covers the
conventions they share.

## Versioning

Kubernetes-style: the version is part of the path, and a version never
changes shape once clients depend on it. A breaking change ships as
`api.v2.<same path>.ts` next to v1, both served until v1's clients are gone.
Additive changes (a new optional field, a new endpoint) stay in v1.

```
/api/v1/public/*    booking: options, slots, bookings,
                    the QPay booking-fee callback      none
/api/v1/admin/*     booking: services, schedule,
                    appointments, booking fee          adminOnly
/api/v1/jobs/*      trigger scheduled jobs             jobToken
```

## Auth: one middleware per route

Every authenticated route lists exactly one of these in `server.middleware`
(see `middleware.ts`):

| Middleware   | Lets through                              | Adds to `context` |
|--------------|-------------------------------------------|-------------------|
| `adminOnly`  | a signed-in user with `users.role = 'admin'` | `admin`         |
| `jobToken`   | `Authorization: Bearer $JOBS_API_TOKEN`   | nothing           |

`adminOnly` uses the same `uc_session` cookie as `/admin` — signing in at
`/admin/login` is what signs you in here. Writes must send
`Content-Type: application/json` (the CSRF guard). `jobToken` is for
machines (an external scheduler): no user, no cookie, no CSRF guard. See
`docs/scheduled-jobs.md`.

## Shape of every response

- Success: the resource as JSON. Money is integer **mungu** (₮ × 100);
  timestamps are ISO strings; dates are `YYYY-MM-DD` in Ulaanbaatar time.
- Failure: `{ "error": { "code", "message", "details"? } }` with a real status.
  `code` is stable (`TIME_TAKEN`, `HOLD_EXISTS`, …) — branch on it, not on
  `message`. Constraint violations from the database map to 409/400 in
  `db-errors.ts`, so races (two bookings for one slot) get a clean answer.

## Where things live

```
src/routes/api.v1.*.ts         wiring + docs only: middleware, input, one call
src/lib/server/api/            this layer: errors, input, middleware
src/lib/server/booking/        the domain — one file per concern, pure logic
                               (time, schedule-plan, availability) unit tested
                               in booking-pure.test.ts
```

A route file never touches the database directly.
