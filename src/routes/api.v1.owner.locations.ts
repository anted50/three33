import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { createLocation, listLocations, locationInput } from '~/lib/server/booking/locations'

/**
 * /api/v1/owner/locations — the places services and products are offered
 *
 * GET   Every location, inactive ones included.
 *       200  Location[]
 *
 * POST  Create a location.
 *       Body { slug, nameMn, nameEn, address, phone?, mapLink?, sortOrder?, isActive? }
 *       201  Location
 *       409  SLUG_TAKEN
 *
 * Auth  owner (ownerOnly)
 */
export const Route = createFileRoute('/api/v1/owner/locations')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: () => handle(() => listLocations({ activeOnly: false })),
      POST: ({ request }) => handle(async () => createLocation(await readBody(request, locationInput)), 201),
    },
  },
})
