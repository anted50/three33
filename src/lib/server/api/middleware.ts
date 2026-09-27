import { createMiddleware } from '@tanstack/react-start'
import { readSessionToken } from './cookie'
import { forbidden, unauthorized } from './errors'
import { errorResponse } from './respond'
import { resolveStaff } from './staff'

/**
 * Request middleware for every authenticated API route. A route opts in by
 * listing ONE of these in `server.middleware`:
 *
 *   staffAuth   any signed-in owner or active barber      -> context.staff
 *   ownerOnly   staffAuth + must be an owner
 *   barberOnly  staffAuth + must have an active barber row -> context.barberId
 *
 * ownerOnly and barberOnly include staffAuth themselves, so a route never
 * lists two. Handlers read identity from `context`, never from the request
 * body: a barber can only ever act as the barber their session belongs to.
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

export const staffAuth = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    if (isCrossSiteWrite(request)) {
      return errorResponse(forbidden('Writes must send Content-Type: application/json'))
    }
    const staff = await resolveStaff(readSessionToken(request))
    if (!staff) return errorResponse(unauthorized())
    return next({ context: { staff } })
  },
)

export const ownerOnly = createMiddleware({ type: 'request' })
  .middleware([staffAuth])
  .server(async ({ context, next }) => {
    if (!context.staff.isOwner) return errorResponse(forbidden('Owner only'))
    return next()
  })

export const barberOnly = createMiddleware({ type: 'request' })
  .middleware([staffAuth])
  .server(async ({ context, next }) => {
    const barberId = context.staff.barberId
    if (!barberId) return errorResponse(forbidden('Barbers only'))
    return next({ context: { barberId } })
  })
