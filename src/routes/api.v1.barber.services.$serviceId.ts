import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { servicePatch, updateService } from '~/lib/server/booking/services'

/**
 * PATCH /api/v1/barber/services/{serviceId} — edit or deactivate a service
 *
 * Booked appointments keep the name, price and duration they were booked
 * with. There is no delete: { "isActive": false } takes it off sale.
 * The location can't change; create a new service there instead.
 *
 * Auth   barber (barberOnly) — only your own services
 * Body   any of { nameEn, nameMn, descriptionEn, descriptionMn, price,
 *                 durationMinutes, isActive, sortOrder }
 * 200    Service
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/barber/services/$serviceId')({
  server: {
    middleware: [barberOnly],
    handlers: {
      PATCH: ({ request, params, context }) =>
        handle(async () =>
          updateService(context.barberId, readId(params, 'serviceId'), await readBody(request, servicePatch)),
        ),
    },
  },
})
