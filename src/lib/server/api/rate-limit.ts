import { env } from 'cloudflare:workers'
import { createMiddleware } from '@tanstack/react-start'
import { assert } from '~/lib/assert'
import { clientIp } from '../client-ip'
import { ApiError } from './errors'
import { errorResponse } from './respond'

/**
 * Per-IP rate limits for the public booking API, on Cloudflare's Workers rate
 * limiter. The limits themselves (how many, per how long) are in
 * wrangler.jsonc under "ratelimits".
 *
 * A route opts in by listing one in `server.middleware`, like adminOnly:
 *
 *   bookingCreateLimit   POST /bookings — a hold and a QPay invoice each
 *   bookingReadLimit     everything a customer reads or polls
 *
 * Not on the QPay callback: those requests come from QPay's own servers,
 * and its HMAC already turns away anyone else.
 */

type LimitName = 'BOOKING_CREATE_LIMIT' | 'BOOKING_READ_LIMIT'

/**
 * The key a request counts against. Every request without an IP (local
 * tools, a misconfigured proxy) shares one key, so they are limited together
 * rather than not at all.
 */
function limitKey(request: Request): string {
  const ip = clientIp((name) => request.headers.get(name))
  if (ip === null) return 'no-ip'
  return ip
}

function rateLimit(name: LimitName) {
  return createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
    const limiter = env[name]
    assert(limiter, `the ${name} binding is configured in wrangler.jsonc`)

    const { success } = await limiter.limit({ key: limitKey(request) })
    if (!success) {
      return errorResponse(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.'))
    }
    return next()
  })
}

export const bookingCreateLimit = rateLimit('BOOKING_CREATE_LIMIT')
export const bookingReadLimit = rateLimit('BOOKING_READ_LIMIT')
