import { createHmac, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { env } from '../env'

/**
 * TEMPORARY ADMIN GATE — a shared token, not real authentication.
 *
 * It exists so the admin section is usable before Phase 2 auth lands. It has
 * none of the properties real auth needs: no per-user identity, no audit trail
 * of who changed what, no revocation short of rotating the token for everyone,
 * and no protection if the token is shared or pasted into a chat.
 *
 * Replace with users.role === 'admin' and a session lookup. When that happens,
 * delete this file — do not leave it as a fallback.
 *
 * Two guards keep it from quietly becoming permanent:
 *  - No ADMIN_TOKEN set means the admin section does not exist at all.
 *  - In production it refuses to work unless ALLOW_TEMP_ADMIN is explicitly
 *    "true", so shipping it takes a deliberate act rather than an oversight.
 */

export const ADMIN_COOKIE = 'uc_admin'

/** Short: this is a stopgap, not a login you stay signed into for a month. */
const ADMIN_MAX_AGE = 60 * 60 * 12

export class AdminDisabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminDisabledError'
  }
}

function assertGateUsable(): string {
  const token = env.ADMIN_TOKEN

  if (!token) {
    throw new AdminDisabledError(
      'ADMIN_TOKEN is not set, so the admin section is disabled.',
    )
  }

  if (env.NODE_ENV === 'production' && env.ALLOW_TEMP_ADMIN !== 'true') {
    throw new AdminDisabledError(
      'The shared-token admin gate is refused in production. Finish Phase 2 ' +
        'auth, or set ALLOW_TEMP_ADMIN=true if you accept a shared password ' +
        'with no per-user audit trail.',
    )
  }

  return token
}

/**
 * The cookie holds an HMAC of the token, not the token itself — so a cookie
 * lifted from a browser cannot be replayed as the password anywhere else.
 */
function tokenFingerprint(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** True when the caller presented a valid admin cookie. */
export function isAdmin(): boolean {
  let token: string
  try {
    token = assertGateUsable()
  } catch {
    return false
  }

  const cookie = getCookie(ADMIN_COOKIE)
  if (!cookie) return false

  return safeEqual(cookie, tokenFingerprint(token))
}

/**
 * Called from the /admin layout's beforeLoad. With the Go layer gone this is
 * the only server-side gate, so it must run on every request rather than once
 * at hydration.
 */
export function requireAdmin(): void {
  if (!isAdmin()) throw new Error('UNAUTHORISED')
}

export function grantAdmin(token: string): { ok: boolean; error?: string } {
  let expected: string
  try {
    expected = assertGateUsable()
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AdminDisabledError
          ? error.message
          : 'Admin is unavailable',
    }
  }

  if (!safeEqual(token, expected)) {
    // Deliberately vague, and no timing signal from the compare above.
    return { ok: false, error: 'Нэвтрэх түлхүүр буруу байна' }
  }

  setCookie(ADMIN_COOKIE, tokenFingerprint(expected), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: ADMIN_MAX_AGE,
  })

  return { ok: true }
}

export function revokeAdmin(): void {
  setCookie(ADMIN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: 0,
  })
}
