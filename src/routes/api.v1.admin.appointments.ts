import { createFileRoute } from '@tanstack/react-router'
import { readQuery } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { appointmentsQuery, listAppointments } from '~/lib/server/booking/appointments'

/**
 * GET /api/v1/admin/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD&status= — bookings
 *
 * Every booking starting in the range (Ulaanbaatar days), earliest first.
 * Without `status`, unpaid holds are left out — they aren't bookings yet.
 *
 * Auth   admin (adminOnly)
 * 200    [{ id, bookingNo, status, serviceName, durationMinutes, startsAt,
 *           endsAt, customerName, customerPhone, customerEmail, note,
 *           bookingFee, paidAt, cancelledAt, … }]
 */
export const Route = createFileRoute('/api/v1/admin/appointments')({
  server: {
    middleware: [adminOnly],
    handlers: {
      GET: ({ request }) => handle(() => listAppointments(readQuery(request, appointmentsQuery))),
    },
  },
})
