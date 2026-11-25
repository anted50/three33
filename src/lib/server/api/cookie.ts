import { SESSION_COOKIE } from '../cookies'

/**
 * API routes return plain Responses, so they read the session cookie
 * themselves rather than through TanStack's request-scoped helpers.
 * Same name and attributes as the admin login — see cookies.ts — so one
 * sign-in works for /admin and /barber alike.
 */

function readCookie(request: Request, name: string): string | null {
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
