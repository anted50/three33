# Email OTP — feasibility

**Verdict: yes, and it is the better default here.** Roughly a day's work once a
sending domain exists.

**Status: shipped for admin.** `/admin/login` — see
`src/lib/server/auth/otp.ts` and `src/lib/server/admin/auth.ts`. This also
retired the temporary shared-token gate, as predicted below. Customer-facing
OTP (checkout accounts, order history) is not built — the pieces below
(`otp_codes`, `sendEmail`, the `users` table) are shared and ready for it, but
nothing calls them from the storefront yet.

## Why passwordless fits this shop

Most customers will buy once or twice a year. A password is friction at the only
moment that matters (checkout) and a liability the rest of the time — we would
store hashes, build reset flows, handle "I forgot", and own a credential worth
stealing. An emailed code has none of that.

We also need an email address anyway: e-barimt receipts and order confirmations
both go there. Asking for a second credential on top buys nothing.

## Prerequisite — this is the actual blocker

Sending needs a **domain we control** with SPF, DKIM and DMARC records. Gmail
dominates Mongolian consumer email and will route unauthenticated mail to spam,
which for an OTP means the login simply does not work.

That is a client action: confirm the domain, then add three DNS records.
Nothing else here is blocked on anything.

## Provider

**Resend** — simple API, good deliverability, free to 3,000 emails/month, which
covers this shop comfortably. AWS SES is cheaper at volume and worth revisiting
if email ever gets used for marketing.

Both work fine from Mongolia; they are ordinary HTTPS APIs.

Mail must be UTF-8 encoded — Cyrillic subjects and bodies otherwise arrive as
mojibake. Worth an explicit test, not an assumption.

## Shape

```
otp_codes(
  id, email, code_hash, expires_at, attempts, consumed_at, created_at
)
```

Store a SHA-256 of the code, never the code — same reasoning as `sessions.id`
and `password_reset_tokens.id`. A database dump should not be a bag of live
login codes.

Rules that make it safe rather than theatre:

- **6 digits, 10 minute TTL.** Long enough to switch apps, short enough that a
  leaked code is stale.
- **Max 5 attempts**, then the code is dead. Without this, six digits is 10^6
  guesses against an endpoint that will happily answer all of them.
- **Rate limit per email and per IP.** Otherwise the form is a free way to send
  mail to strangers.
- **Single use**, and requesting a new code invalidates the old one.
- **Constant-time compare**, as with the callback HMAC.
- **Do not reveal whether an address exists.** Same response either way.

On success, mint the same DB-backed session the rest of the app already uses —
`createSession` in `lib/server/auth/session.ts` is written and waiting.

## The part worth noticing

**This also retires the temporary admin gate.** Email OTP restricted to an
allowlist gives real per-user admin identity — who changed a price, who
cancelled an order — which the shared token in `ADMIN_TOKEN` fundamentally
cannot. That currently sits as a separate task assuming argon2id passwords;
OTP gets there sooner and with less to maintain.

## Risks

- **Delivery latency.** Normally under five seconds; occasionally not. The UI
  should say "check your email" with a resend button on a 30s cooldown, not spin.
- **Typo'd address = locked out**, with no password fallback. Mitigate by
  echoing the address back before sending.
- **SMS is the Mongolian habit.** If email OTP tests badly with real customers,
  a local SMS gateway can be swapped in behind the same interface — the code
  delivery mechanism is one function.
