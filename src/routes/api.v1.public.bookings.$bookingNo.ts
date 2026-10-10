import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { readQuery } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { bookingStatus } from '~/lib/server/booking/online/status'

/**
 * GET /api/v1/public/bookings/{bookingNo}?t={token} — the customer's booking page
 *
 * state:  holding     fee not paid yet — invoice and expiresAt included
 *         confirmed   booked; call the barber (barber.phone) to change it
 *         completed | cancelled | no_show
 * A wrong token and a hold that expired unpaid both answer 404 NOT_BOOKED,
 * so booking numbers can't be probed.
 *
 * Auth   the token from POST /public/bookings
 * 200    { bookingNo, state, startsAt, endsAt, location, barber: { name, phone },
 *          services, total, bookingFee, dueAtShop, feePaid,
 *          expiresAt?, invoice? }
 * 404    NOT_BOOKED
 */
const query = z.object({ t: z.string().min(10).max(100) })

export const Route = createFileRoute('/api/v1/public/bookings/$bookingNo')({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(() => bookingStatus(params.bookingNo, readQuery(request, query).t)),
    },
  },
})
