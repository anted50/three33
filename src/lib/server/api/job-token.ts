import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Checks an `Authorization: Bearer <token>` header against JOBS_API_TOKEN.
 *
 * Both sides are hashed before comparing so the comparison is fixed-length:
 * timingSafeEqual throws on a length mismatch, and checking lengths first
 * would leak the secret's length, which — unlike a callback HMAC — is not
 * public.
 *
 * Pure: no framework or env import, so it is unit tested directly.
 */
export function verifyJobToken(
  authorization: string | null | undefined,
  expected: string,
): boolean {
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')?.[1]
  if (!token || !expected) return false

  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(token), digest(expected))
}
