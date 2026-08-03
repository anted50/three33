/**
 * Minimal cookie serialise/parse. Deliberately dependency-free and pure so the
 * session attributes that matter for security (httpOnly, SameSite, Secure) are
 * unit-testable rather than trusted to a framework helper.
 */

export interface CookieOptions {
  maxAge?: number // seconds
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const {
    maxAge,
    path = '/',
    httpOnly = true,
    secure = process.env.NODE_ENV === 'production',
    sameSite = 'Lax',
  } = options

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`]
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(maxAge)}`)
    // Belt and braces for older clients that ignore Max-Age.
    parts.push(`Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`)
  }
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  parts.push(`SameSite=${sameSite}`)

  return parts.join('; ')
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    const name = pair.slice(0, eq).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(pair.slice(eq + 1).trim())
    } catch {
      // A malformed cookie is a missing cookie, not a 500.
    }
  }

  return out
}

/** Expire a cookie by setting it empty with Max-Age=0. */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAge: 0 })
}
