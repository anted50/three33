import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { readBody, readId } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { replaceLocations } from '~/lib/server/booking/barber-locations'
import { getBarber } from '~/lib/server/booking/barbers'

/**
 * PUT /api/v1/owner/barbers/{barberId}/locations — where a barber may work
 *
 * Replaces the whole set. The barber can only create services and shifts at
 * these locations. Removing one they still have active services or upcoming
 * shifts at is refused, so nothing disappears silently.
 *
 * Auth   owner (ownerOnly)
 * Body   { "locationIds": [uuid, …] }   at least one
 * 200    Barber
 * 400    VALIDATION / unknown location
 * 404    NOT_FOUND
 * 409    LOCATION_IN_USE
 */
const body = z.object({ locationIds: z.array(z.uuid()).min(1).max(20) })

export const Route = createFileRoute('/api/v1/owner/barbers/$barberId/locations')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      PUT: ({ request, params }) =>
        handle(async () => {
          const barberId = readId(params, 'barberId')
          await getBarber(barberId)
          const { locationIds } = await readBody(request, body)
          await replaceLocations(barberId, locationIds)
          return getBarber(barberId)
        }),
    },
  },
})
