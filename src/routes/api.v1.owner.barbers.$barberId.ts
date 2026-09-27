import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getBarber, updateBarber, updateBarberInput } from '~/lib/server/booking/barbers'

/**
 * /api/v1/owner/barbers/{barberId}
 *
 * GET    One barber: profile, login email, locationIds, current terms.
 *        200  Barber
 *
 * PATCH  Edit the barber. { "isActive": false } ends their access at once —
 *        sign-in and every /barber request check it — and hides them from
 *        customers. { "email" } changes their login address.
 *        Body any of { email, slug, name, phone, bioMn, bioEn, photoUrl,
 *                      bookingFee, bufferMinutes, sortOrder, isActive }
 *        200  Barber
 *        409  EMAIL_TAKEN, SLUG_TAKEN, NO_LOGIN
 *
 * Locations and terms have their own subresources: /locations, /terms.
 *
 * Auth   owner (ownerOnly)
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/owner/barbers/$barberId')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: ({ params }) => handle(() => getBarber(readId(params, 'barberId'))),
      PATCH: ({ request, params }) =>
        handle(async () => updateBarber(readId(params, 'barberId'), await readBody(request, updateBarberInput))),
    },
  },
})
