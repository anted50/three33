import { createFileRoute } from '@tanstack/react-router'
import { clearedSessionCookie, readSessionToken, sessionCookie } from '~/lib/server/api/cookie'
import { readBody, requestMeta } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { resolveStaff } from '~/lib/server/api/staff'
import { codeVerifyInput, verifyCode } from '~/lib/server/api/staff-login'
import { invalidateSession } from '~/lib/server/auth/session'

/**
 * /api/v1/auth/session — step 2 of staff sign-in, and sign-out
 *
 * POST    Exchange the emailed code for a session cookie (uc_session,
 *         HttpOnly, 30 days). The same cookie the /admin area uses.
 *         Auth   none
 *         Body   { "email": "bat@three33.mn", "code": "123456" }
 *         200    Staff — { userId, email, name, isOwner, barberId }
 *         401    CODE_REJECTED  wrong, expired, or too many tries
 *         403    NOT_STAFF      valid code, but no longer owner/active barber
 *
 * DELETE  Sign out: deletes the session and clears the cookie.
 *         Auth   the session cookie, if any (no-op without one)
 *         204
 */
export const Route = createFileRoute('/api/v1/auth/session')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          const input = await readBody(request, codeVerifyInput)
          const token = await verifyCode(input, requestMeta(request))
          const staff = await resolveStaff(token)
          return Response.json(staff, { headers: { 'Set-Cookie': sessionCookie(token) } })
        }),

      DELETE: ({ request }) =>
        handle(async () => {
          const token = readSessionToken(request)
          if (token) await invalidateSession(token)
          return new Response(null, { status: 204, headers: { 'Set-Cookie': clearedSessionCookie() } })
        }),
    },
  },
})
