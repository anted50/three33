import { SESSION_COOKIE, sessionCookieOptions } from '../cookies'

/**
 * API routes return plain Responses, so they read and write the session
 * cookie themselves rather than through TanStack's request-scoped helpers.
 * Same name and attributes as the admin login — see cookies.ts — so one
 * sign-in works for /admin and /barber alike.
 */

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE)
}

export function sessionCookie(token: string, maxAge = sessionCookieOptions.maxAge): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${sessionCookieOptions.path ?? '/'}`,
    `Max-Age=${maxAge ?? 0}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (sessionCookieOptions.secure) parts.push('Secure')
  return parts.join('; ')
}

export const clearedSessionCookie = () => sessionCookie('', 0)
