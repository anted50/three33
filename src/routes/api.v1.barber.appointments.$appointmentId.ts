import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getAppointment } from '~/lib/server/booking/appointments/queries'

/**
 * GET /api/v1/barber/appointments/{appointmentId} — one booking in full
 *
 * Includes the customer's contact details (for calling them), the booked
 * services, its history, any booking-fee payment, and the open checkout.
 * Actions are subresources: /reschedule, /cancel, /no-show, /checkout.
 *
 * Auth   barber (barberOnly) — only your own
 * 200    Appointment & { services, events, feePayments, checkout }
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ params, context }) => handle(() => getAppointment(context.barberId, readId(params, 'appointmentId'))),
    },
  },
})
