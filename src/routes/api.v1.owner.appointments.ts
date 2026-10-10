import { createFileRoute } from '@tanstack/react-router'
import { readQuery } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { listAllAppointments, ownerAppointmentsQuery } from '~/lib/server/booking/oversight'

/**
 * GET /api/v1/owner/appointments — every booking, across barbers and locations
 *
 * Read-only. Unpaid online holds are left out unless status=pending is asked
 * for. Up to 500, earliest first.
 *
 * Auth   owner (ownerOnly)
 * Query  from, to (YYYY-MM-DD, required); barberId?; locationId?;
 *        status? (pending | booked | completed | cancelled | no_show)
 * 200    [Appointment & { barberName, locationName }]
 */
export const Route = createFileRoute('/api/v1/owner/appointments')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: ({ request }) => handle(() => listAllAppointments(readQuery(request, ownerAppointmentsQuery))),
    },
  },
})
