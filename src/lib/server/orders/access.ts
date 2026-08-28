import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import {
  CHECKOUT_COOKIE,
  checkoutCookieOptions,
} from '../cookies'

/**
 * Who is allowed to look at an order.
 *
 * Order numbers cannot be the credential. UD-YYMMDD-XXXX is four characters
 * from a 32-letter alphabet — about a million per day — and it is deliberately
 * short because customers read it aloud over the phone. Anyone willing to
 * enumerate it could previously read a stranger's phone number, address and
 * basket, and could make our server spend a QPay /payment/check per request
 * while doing it.
 *
 * So a separate secret guards the order, and only its SHA-256 lands in the
 * database — the same reasoning as sessions.id: a dump of the orders table
 * yields no working links.
 *
 * Deliberately imports no database. The comparison below is the part worth
 * testing, and it should be testable without a Postgres connection.
 */

/** 24 bytes of base64url — the same size as the cart's session token. */
export function mintOrderToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: hashOrderToken(token) }
}

export function hashOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyOrderToken(
  token: string | null | undefined,
  hash: string | null | undefined,
): boolean {
  if (!token || !hash) return false

  const a = Buffer.from(hashOrderToken(token), 'utf8')
  const b = Buffer.from(hash, 'utf8')

  // timingSafeEqual throws on a length mismatch, so check first. Both sides are
  // fixed-length hex digests, so short-circuiting here leaks nothing.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * The cookie carries which order it is for, not just the token. Without the
 * order number a stale cookie from a previous checkout would be offered as
 * proof for a different order and rejected, logging the customer out of an
 * invoice they can actually see.
 */
export function encodeCheckoutCookie(orderNo: string, token: string): string {
  return `${orderNo}:${token}`
}

export function decodeCheckoutCookie(
  value: string | null | undefined,
): { orderNo: string; token: string } | null {
  if (!value) return null

  // Split on the first colon only: base64url never contains one, but order
  // numbers are shop-controlled and this should not depend on that.
  const at = value.indexOf(':')
  if (at <= 0 || at === value.length - 1) return null

  return { orderNo: value.slice(0, at), token: value.slice(at + 1) }
}

// ---------------------------------------------------------------------------
// Request-bound helpers. Everything above is pure.
// ---------------------------------------------------------------------------

/**
 * The token proving the caller may see `orderNo`, from whichever of the two
 * channels still has it.
 *
 * Two channels because either one alone strands people. The cookie handles the
 * ordinary case, including the return trip from a bank app — SameSite=Lax, for
 * the same reason the cart cookie is (see cookies.ts). The explicit token
 * handles a payment link opened on a second device, where no cookie exists.
 */
export function readCheckoutToken(
  orderNo: string,
  explicit?: string | null,
): string | null {
  if (explicit) return explicit

  const cookie = decodeCheckoutCookie(getCookie(CHECKOUT_COOKIE))
  if (cookie && cookie.orderNo === orderNo) return cookie.token

  return null
}

export function setCheckoutCookie(orderNo: string, token: string): void {
  setCookie(
    CHECKOUT_COOKIE,
    encodeCheckoutCookie(orderNo, token),
    checkoutCookieOptions,
  )
}
