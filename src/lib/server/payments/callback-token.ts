import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Our callback URLs are public — each provider has to reach its own, so
 * anyone can. The `t` query parameter is an HMAC over the order number,
 * proving that a callback naming order X actually came from a URL we
 * generated when we created X's invoice, rather than from someone
 * enumerating order numbers.
 *
 * This does NOT prove payment. Nothing here does. It only decides whether the
 * request is worth spending a settlement check on. Settlement always comes
 * from asking the provider directly. Both QPay and StorePay callback routes
 * share this scheme, signed with their own secret.
 */

export function signCallbackToken(orderNo: string, secret: string): string {
  if (!secret) {
    throw new Error('QPAY_CALLBACK_SECRET is empty; refusing to sign')
  }
  return createHmac('sha256', secret).update(orderNo).digest('hex')
}

export function verifyCallbackToken(
  orderNo: string,
  token: string | null | undefined,
  secret: string,
): boolean {
  if (!token) return false

  const expected = signCallbackToken(orderNo, secret)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(token, 'utf8')

  // timingSafeEqual throws on length mismatch, so check first. Token length is
  // fixed and public, so short-circuiting on it leaks nothing.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Builds the absolute callback URL handed to a provider at invoice creation. */
export function buildCallbackUrl(
  appUrl: string,
  path: string,
  orderNo: string,
  secret: string,
): string {
  const url = new URL(path, appUrl)
  url.searchParams.set('order', orderNo)
  url.searchParams.set('t', signCallbackToken(orderNo, secret))
  return url.toString()
}
