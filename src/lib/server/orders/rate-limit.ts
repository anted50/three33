/**
 * How many checkouts one person may start in an hour.
 *
 * Checkout is not an ordinary write. Each successful call mints a real invoice
 * on the merchant's QPay account, and QPay's own integration notes are explicit
 * that a merchant who hammers their endpoints gets throttled (see the token
 * discipline in payments/qpay/client.ts). An unmetered endpoint that spends a
 * shared, rate-limited third-party resource is the problem being fixed here;
 * the rows it leaves in our own tables are the smaller half.
 *
 * Two keys, because either alone is trivially sidestepped: an IP covers one
 * script hitting the endpoint in a loop, a phone number covers the same script
 * moving between addresses. Both are generous enough that a real customer
 * fixing a typo in their address never sees them.
 */

/** A household on one connection can plausibly place a few orders in an hour. */
export const MAX_PER_IP_PER_HOUR = 10

/** Retrying the same order with a corrected address should never need five. */
export const MAX_PER_PHONE_PER_HOUR = 5

export const RATE_WINDOW_MS = 60 * 60 * 1000

export interface AttemptCounts {
  /** Null when the proxy stripped the address; the phone limit still applies. */
  byIp: number | null
  byPhone: number
}

export interface RateLimits {
  perIp: number
  perPhone: number
}

export const DEFAULT_LIMITS: RateLimits = {
  perIp: MAX_PER_IP_PER_HOUR,
  perPhone: MAX_PER_PHONE_PER_HOUR,
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'ip' | 'phone' }

/**
 * Counts are of attempts *already recorded* in the window, so the comparison is
 * `>=`: at the limit, the next one is refused.
 */
export function decideRateLimit(
  counts: AttemptCounts,
  limits: RateLimits = DEFAULT_LIMITS,
): RateLimitDecision {
  if (counts.byPhone >= limits.perPhone) {
    return { allowed: false, reason: 'phone' }
  }
  if (counts.byIp !== null && counts.byIp >= limits.perIp) {
    return { allowed: false, reason: 'ip' }
  }
  return { allowed: true }
}
