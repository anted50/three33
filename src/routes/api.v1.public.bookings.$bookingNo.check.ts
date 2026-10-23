import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { readQuery } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { checkBookingFee } from '~/lib/server/booking/fee'
import { findByToken } from '~/lib/server/booking/status'

/**
 * POST /api/v1/public/bookings/{bookingNo}/check?t={token} — poll the fee
 *
 * The booking page calls this while the customer pays. When QPay confirms
 * the fee, the booking is confirmed and the confirmation email is sent.
 * QPay is asked at most every 3 seconds; extra polls just return the status.
 *
 * Auth   the token from POST /public/bookings
 * Body   {}
 * 200    { status: pending | booked, checked, outcome? }
 * 404    NOT_BOOKED
 */
const query = z.object({ t: z.string().min(10).max(100) })

export const Route = createFileRoute('/api/v1/public/bookings/$bookingNo/check')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(async () => checkBookingFee((await findByToken(params.bookingNo, readQuery(request, query).t)).id)),
    },
  },
})
