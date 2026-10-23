import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { createService, listServices, serviceInput } from '~/lib/server/booking/services'

/**
 * GET  /api/v1/admin/services — every service, active or not
 * POST /api/v1/admin/services — add one
 *
 * Auth   admin (adminOnly)
 * Body   { name, durationMinutes 5–600, description?, price?, mungu,
 *          isActive?, sortOrder? }
 * 200    Service[]          (GET)
 * 201    Service            (POST)
 */
export const Route = createFileRoute('/api/v1/admin/services')({
  server: {
    middleware: [adminOnly],
    handlers: {
      GET: () => handle(() => listServices({ activeOnly: false })),
      POST: ({ request }) => handle(async () => createService(await readBody(request, serviceInput)), 201),
    },
  },
})
