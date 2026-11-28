import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { readQuery } from '~/lib/server/api/input'
import { bookingReadLimit } from '~/lib/server/api/rate-limit'
import { handle } from '~/lib/server/api/respond'
import { bookingStatus } from '~/lib/server/booking/status'

/**
 * GET /api/v1/public/bookings/{bookingNo}?t={token} — the customer's booking
 *
 * Auth   the token from POST /public/bookings; rate-limited per IP (bookingReadLimit)
 * 200    { bookingNo, state: holding | confirmed | cancelled, service,
 *          startsAt, endsAt, customerName, bookingFee, feePaid,
 *          expiresAt?, invoice? }        the last two only while holding
 * 404    NOT_BOOKED   wrong token, or a hold that was never paid
 */
const query = z.object({ t: z.string().min(10).max(100) })

export const Route = createFileRoute('/api/v1/public/bookings/$bookingNo')({
  server: {
    middleware: [bookingReadLimit],
    handlers: {
      GET: ({ request, params }) => handle(() => bookingStatus(params.bookingNo, readQuery(request, query).t)),
    },
  },
})
