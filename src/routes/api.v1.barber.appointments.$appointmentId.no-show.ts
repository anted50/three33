import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { markNoShow, reasonInput } from '~/lib/server/booking/appointments/change'

/**
 * POST /api/v1/barber/appointments/{appointmentId}/no-show
 *
 * The customer never came. Only after the start time. The booking fee is
 * kept — that's what it is for.
 *
 * Auth   barber (barberOnly)
 * Body   { "reason"?: "…" }
 * 200    Appointment
 * 404    NOT_FOUND
 * 409    NOT_BOOKED, NOT_STARTED
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId/no-show')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ request, params, context }) =>
        handle(async () =>
          markNoShow(context.staff, context.barberId, readId(params, 'appointmentId'), await readBody(request, reasonInput)),
        ),
    },
  },
})
