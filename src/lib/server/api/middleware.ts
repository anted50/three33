import { createMiddleware } from '@tanstack/react-start'
import { env } from '../env'
import { readSessionToken } from './cookie'
import { ApiError, forbidden, unauthorized } from './errors'
import { verifyJobToken } from './job-token'
import { errorResponse } from './respond'
import { validateSessionToken } from '../auth/session'

/**
 * Request middleware for API routes. A route opts in by listing ONE of these
 * in `server.middleware`:
 *
 *   adminOnly   a signed-in admin (users.role = 'admin') -> context.admin
 *   jobToken    bearer JOBS_API_TOKEN, for schedulers — no user at all
 *
 * adminOnly uses the same session cookie as the /admin pages: signing in at
 * /admin/login is what signs you in here. Handlers read identity from
 * `context`, never from the request body.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF guard for cookie-authenticated writes. A write must declare a JSON
 * body type, which a plain HTML form on another site cannot send and a
 * cross-origin script can only send after a CORS preflight — which these
 * routes never approve. Together with SameSite=Lax cookies that closes the
 * cross-site request path.
 */
function isCrossSiteWrite(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false
  const type = request.headers.get('content-type') ?? ''
  return !type.toLowerCase().startsWith('application/json')
}

export interface Admin {
  userId: string
  email: string
  name: string
}

export const adminOnly = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    if (isCrossSiteWrite(request)) {
      return errorResponse(forbidden('Writes must send Content-Type: application/json'))
    }
    // Re-read on every request, so a revoked session or a demoted admin is
    // locked out on their very next call.
    const user = await validateSessionToken(readSessionToken(request))
    if (!user) return errorResponse(unauthorized())
    if (user.role !== 'admin') return errorResponse(forbidden('Admins only'))
    const admin: Admin = { userId: user.id, email: user.email, name: user.name }
    return next({ context: { admin } })
  },
)

/**
 * Machine auth for /api/v1/jobs/*: `Authorization: Bearer <JOBS_API_TOKEN>`.
 * No session and no CSRF guard — there is no cookie to ride on, and an
 * external scheduler should not have to send a body just to set its type.
 */
export const jobToken = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    if (!env.JOBS_API_TOKEN) {
      return errorResponse(
        new ApiError(503, 'JOBS_API_DISABLED', 'JOBS_API_TOKEN is not set on this server'),
      )
    }
    if (!verifyJobToken(request.headers.get('authorization'), env.JOBS_API_TOKEN)) {
      return errorResponse(unauthorized('Missing or invalid bearer token'))
    }
    return next()
  },
)
