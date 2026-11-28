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
  // Bounded by the header itself; Workers cap request headers at 128 KB.
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue
    if (part.slice(0, separatorIndex).trim() === name) {
      return decodeCookieValue(part.slice(separatorIndex + 1).trim())
    }
  }
  return null
}

/**
 * A value that is not valid percent-encoding cannot be a session token we
 * issued, so it reads as no cookie (401) rather than a URIError (500).
 */
function decodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE)
}
