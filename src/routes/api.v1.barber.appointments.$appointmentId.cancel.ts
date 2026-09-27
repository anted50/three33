import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { cancel, reasonInput } from '~/lib/server/booking/appointments/change'

/**
 * POST /api/v1/barber/appointments/{appointmentId}/cancel
 *
 * Confirms a cancellation — only the barber can; customers call them. Any
 * booking fee is kept (no refunds). The time frees up for other bookings.
 *
 * Auth   barber (barberOnly)
 * Body   { "reason"?: "Customer called, moving abroad" }
 * 200    Appointment
 * 404    NOT_FOUND
 * 409    NOT_BOOKED, CHECKOUT_OPEN (void the open checkout first)
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId/cancel')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ request, params, context }) =>
        handle(async () =>
          cancel(context.staff, context.barberId, readId(params, 'appointmentId'), await readBody(request, reasonInput)),
        ),
    },
  },
})
