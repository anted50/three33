import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { createService, listServices, serviceInput } from '~/lib/server/booking/services'

/**
 * /api/v1/barber/services — the barber's own services
 *
 * GET   All of them, active and inactive, at every location.
 *       200  Service[]
 *
 * POST  Create one at a location the owner assigned to you. The same service
 *       at another location is a separate row with its own price.
 *       Body { locationId, nameEn, nameMn?, descriptionEn?, descriptionMn?,
 *              price (mungu), durationMinutes, isActive?, sortOrder? }
 *       201  Service
 *       403  FORBIDDEN  not assigned to that location
 *
 * Auth  barber (barberOnly)
 */
export const Route = createFileRoute('/api/v1/barber/services')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ context }) => handle(() => listServices(context.barberId)),
      POST: ({ request, context }) =>
        handle(async () => createService(context.barberId, await readBody(request, serviceInput)), 201),
    },
  },
})
