import { createFileRoute } from '@tanstack/react-router'
import { readBody, readQuery } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { barberBookingInput, createBarberBooking } from '~/lib/server/booking/appointments/create'
import { appointmentsQuery, listAppointments } from '~/lib/server/booking/appointments/queries'

/**
 * /api/v1/barber/appointments — the barber's bookings
 *
 * GET   Bookings starting in a date range (unpaid online holds excluded).
 *       Query from, to (YYYY-MM-DD, required); status?; needsReschedule=true?
 *       200  [Appointment & { services: [{ serviceId, name, price, durationMinutes }] }]
 *
 * POST  Enter a booking yourself — a phone call or someone at the chair.
 *       Confirmed at once, no booking fee, at ANY time: inside a shift it
 *       takes those slots from online booking; outside, it's overtime and
 *       leaves the schedule alone.
 *       Body { locationId, startsAt (ISO), serviceIds: [uuid, …],
 *              customerName, customerPhone, customerEmail?, note? }
 *       201  Appointment (with services, events, feePayments, checkout)
 *       400  unknown or inactive service at that location
 *       403  not assigned to that location
 *       409  TIME_TAKEN  overlaps another of your bookings (buffer included)
 *
 * Auth  barber (barberOnly)
 */
export const Route = createFileRoute('/api/v1/barber/appointments')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ request, context }) => handle(() => listAppointments(context.barberId, readQuery(request, appointmentsQuery))),
      POST: ({ request, context }) =>
        handle(async () => createBarberBooking(context.staff, context.barberId, await readBody(request, barberBookingInput)), 201),
    },
  },
})
