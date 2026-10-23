/**
 * The client's IP address, for rate limiting and session records.
 *
 * On Cloudflare the answer is CF-Connecting-IP: Cloudflare sets it from the
 * connection itself, and a client cannot forge it. X-Forwarded-For is only a
 * fallback (local dev): Cloudflare appends to whatever the client sent, so its
 * leftmost entry is client-controlled and would let anyone dodge the checkout
 * rate limit by sending a fresh value each time.
 *
 * Pure: takes a header getter, so it works for server functions
 * (getRequestHeader) and API routes (request.headers) alike.
 */
export function clientIp(header: (name: string) => string | null | undefined): string | null {
  const connecting = header('cf-connecting-ip')?.trim()
  if (connecting) return connecting
  const forwarded = header('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || null
}
