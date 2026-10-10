import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { reschedule, rescheduleInput } from '~/lib/server/booking/appointments/change'

/**
 * POST /api/v1/barber/appointments/{appointmentId}/reschedule
 *
 * Moves the booking to a new start time — any time, inside your shifts or
 * not. Same booking, so a paid booking fee carries over. Length and buffer
 * stay as booked. Clears the emergency flag; the move is logged.
 *
 * Auth   barber (barberOnly)
 * Body   { "startsAt": "2026-10-06T15:00:00+08:00" }
 * 200    Appointment
 * 404    NOT_FOUND
 * 409    NOT_BOOKED (already completed/cancelled), TIME_TAKEN
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId/reschedule')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ request, params, context }) =>
        handle(async () =>
          reschedule(context.staff, context.barberId, readId(params, 'appointmentId'), await readBody(request, rescheduleInput)),
        ),
    },
  },
})
