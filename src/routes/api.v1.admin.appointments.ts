import { createFileRoute } from '@tanstack/react-router'
import { readBody, readQuery } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { adminBookingInput, appointmentsQuery, createAdminBooking, listAppointments } from '~/lib/server/booking/appointments'

/**
 * GET  /api/v1/admin/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD&status= — bookings
 *
 * Every booking starting in the range (Ulaanbaatar days), earliest first.
 * Without `status`, unpaid holds are left out — they aren't bookings yet.
 *
 * POST /api/v1/admin/appointments — enter a booking by hand
 *
 * A phone call or a walk-in: booked at once, no fee, at any time (not held
 * to the schedule). With an email, the confirmation goes out.
 *
 * Auth   admin (adminOnly)
 * Body   { serviceId, startsAt, customerName, customerPhone, customerEmail?, note? }
 * 200    [{ id, bookingNo, source: online | admin, status, serviceName,
 *           durationMinutes, startsAt, endsAt, customerName, customerPhone,
 *           customerEmail, note, bookingFee, paidAt, cancelledAt, … }]   (GET)
 * 201    the booking                                                     (POST)
 * 404    unknown or inactive service
 * 409    TIME_TAKEN   it would overlap another booking
 */
export const Route = createFileRoute('/api/v1/admin/appointments')({
  server: {
    middleware: [adminOnly],
    handlers: {
      GET: ({ request }) => handle(() => listAppointments(readQuery(request, appointmentsQuery))),
      POST: ({ request }) => handle(async () => createAdminBooking(await readBody(request, adminBookingInput)), 201),
    },
  },
})
