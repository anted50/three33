import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getLocation, locationPatch, updateLocation } from '~/lib/server/booking/locations'

/**
 * /api/v1/owner/locations/{locationId}
 *
 * GET    One location.
 *        200  Location
 *
 * PATCH  Edit any field. There is no delete: set { "isActive": false } to
 *        hide it from customers; its history stays intact.
 *        Body any of { slug, nameMn, nameEn, address, phone, mapLink, sortOrder, isActive }
 *        200  Location
 *        409  SLUG_TAKEN
 *
 * Auth   owner (ownerOnly)
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/owner/locations/$locationId')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: ({ params }) => handle(() => getLocation(readId(params, 'locationId'))),
      PATCH: ({ request, params }) =>
        handle(async () => updateLocation(readId(params, 'locationId'), await readBody(request, locationPatch))),
    },
  },
})
