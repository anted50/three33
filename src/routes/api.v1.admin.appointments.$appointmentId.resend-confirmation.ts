import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { resendConfirmation } from '~/lib/server/booking/appointments'

/**
 * POST /api/v1/admin/appointments/{appointmentId}/resend-confirmation
 *
 * Emails the confirmation again, with the booking's current time — after a
 * reschedule, or when the customer says it never arrived.
 *
 * Auth   admin (adminOnly)
 * Body   {}
 * 200    { outcome: sent | mail_disabled }
 * 404    unknown booking
 * 409    NOT_BOOKED
 */
export const Route = createFileRoute('/api/v1/admin/appointments/$appointmentId/resend-confirmation')({
  server: {
    middleware: [adminOnly],
    handlers: {
      POST: ({ params }) => handle(() => resendConfirmation(readId(params, 'appointmentId'))),
    },
  },
})
