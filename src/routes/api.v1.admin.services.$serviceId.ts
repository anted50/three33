import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { servicePatch, updateService } from '~/lib/server/booking/services'

/**
 * PATCH /api/v1/admin/services/{serviceId} — edit, or turn off with
 * { isActive: false }. There is no delete. Existing bookings keep the name
 * and length they were booked with.
 *
 * Auth   admin (adminOnly)
 * Body   any of { name, description, durationMinutes, price, isActive, sortOrder }
 * 200    Service
 * 404    unknown service
 */
export const Route = createFileRoute('/api/v1/admin/services/$serviceId')({
  server: {
    middleware: [adminOnly],
    handlers: {
      PATCH: ({ request, params }) =>
        handle(async () => updateService(readId(params, 'serviceId'), await readBody(request, servicePatch))),
    },
  },
})
