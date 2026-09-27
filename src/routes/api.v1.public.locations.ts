import { createFileRoute } from '@tanstack/react-router'
import { handle } from '~/lib/server/api/respond'
import { listLocations } from '~/lib/server/booking/locations'

/**
 * GET /api/v1/public/locations — step 1 of booking: pick a location
 *
 * Auth   none
 * 200    Location[] — active only, in display order
 *        { id, slug, nameMn, nameEn, address, phone, mapLink, … }
 */
export const Route = createFileRoute('/api/v1/public/locations')({
  server: {
    handlers: {
      GET: () =>
        handle(async () =>
          (await listLocations({ activeOnly: true })).map(({ id, slug, nameMn, nameEn, address, phone, mapLink }) => ({
            id,
            slug,
            nameMn,
            nameEn,
            address,
            phone,
            mapLink,
          })),
        ),
    },
  },
})
