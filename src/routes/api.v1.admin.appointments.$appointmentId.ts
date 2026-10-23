import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getAppointment } from '~/lib/server/booking/appointments'

/**
 * GET /api/v1/admin/appointments/{appointmentId} — one booking
 *
 * Auth   admin (adminOnly)
 * 200    the booking, as in the list
 * 404    unknown booking
 */
export const Route = createFileRoute('/api/v1/admin/appointments/$appointmentId')({
  server: {
    middleware: [adminOnly],
    handlers: {
      GET: ({ params }) => handle(() => getAppointment(readId(params, 'appointmentId'))),
    },
  },
})
