import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { cancel } from '~/lib/server/booking/appointments'

/**
 * POST /api/v1/admin/appointments/{appointmentId}/cancel — cancel a booking
 *
 * The time becomes free for others at once, and the customer is emailed (if
 * the booking has an email). The booking fee is non-refundable: it is kept.
 *
 * Auth   admin (adminOnly)
 * Body   {}
 * 200    the booking
 * 404    unknown booking
 * 409    NOT_BOOKED   only a confirmed booking can be cancelled
 */
export const Route = createFileRoute('/api/v1/admin/appointments/$appointmentId/cancel')({
  server: {
    middleware: [adminOnly],
    handlers: {
      POST: ({ params }) => handle(() => cancel(readId(params, 'appointmentId'))),
    },
  },
})
