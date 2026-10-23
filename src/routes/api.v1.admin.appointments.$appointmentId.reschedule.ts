import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { reschedule, rescheduleInput } from '~/lib/server/booking/appointments'

/**
 * POST /api/v1/admin/appointments/{appointmentId}/reschedule — move a booking
 *
 * Any time — the admin is not held to the schedule. The length stays as
 * booked. The customer is not emailed automatically; use resend-confirmation.
 *
 * Auth   admin (adminOnly)
 * Body   { startsAt }   ISO
 * 200    the booking
 * 404    unknown booking
 * 409    NOT_BOOKED   only a confirmed booking can be moved
 *        TIME_TAKEN   it would overlap another booking
 */
export const Route = createFileRoute('/api/v1/admin/appointments/$appointmentId/reschedule')({
  server: {
    middleware: [adminOnly],
    handlers: {
      POST: ({ request, params }) =>
        handle(async () => reschedule(readId(params, 'appointmentId'), await readBody(request, rescheduleInput))),
    },
  },
})
