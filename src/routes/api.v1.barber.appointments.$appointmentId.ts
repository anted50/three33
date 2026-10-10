import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { editAppointment, editInput } from '~/lib/server/booking/appointments/edit'
import { getAppointment } from '~/lib/server/booking/appointments/queries'

/**
 * /api/v1/barber/appointments/{appointmentId} — one booking
 *
 * GET    In full: the customer's contact details (for calling them), the
 *        booked services, its history, any booking-fee payment, the open
 *        checkout.
 *        200  Appointment & { services, events, feePayments, checkout }
 *
 * PATCH  Change a booked appointment before checkout: its services (the
 *        total and end time follow; the start stays), note, or the
 *        customer's contact details. Logged as 'updated'.
 *        Body any of { serviceIds: [uuid, …], note, customerName,
 *                      customerPhone, customerEmail }
 *        200  Appointment
 *        400  unknown service here; total below a booking fee already paid
 *        409  NOT_BOOKED, CHECKOUT_OPEN, TIME_TAKEN (now runs into the next booking)
 *
 * Actions are subresources: /reschedule, /cancel, /no-show, /checkout,
 * /resend-confirmation.
 *
 * Auth   barber (barberOnly) — only your own
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ params, context }) => handle(() => getAppointment(context.barberId, readId(params, 'appointmentId'))),
      PATCH: ({ request, params, context }) =>
        handle(async () =>
          editAppointment(context.staff, context.barberId, readId(params, 'appointmentId'), await readBody(request, editInput)),
        ),
    },
  },
})
