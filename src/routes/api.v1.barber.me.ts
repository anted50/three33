import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getProfile, profilePatch, updateProfile } from '~/lib/server/booking/profile'

/**
 * /api/v1/barber/me — the signed-in barber's own settings
 *
 * GET    Profile, locations and current terms (terms are read-only here).
 *        200  Barber
 *
 * PATCH  The barber's own settings, including the booking fee.
 *        bookingFee: mungu; 0 = no online booking ("call to book").
 *        Changes apply to NEW bookings only — existing ones froze theirs.
 *        Body any of { phone, bioMn, bioEn, photoUrl, bookingFee, bufferMinutes }
 *        200  Barber
 *
 * Name, slug, active, locations and terms are the owner's to change.
 *
 * Auth   barber (barberOnly)
 */
export const Route = createFileRoute('/api/v1/barber/me')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ context }) => handle(() => getProfile(context.barberId)),
      PATCH: ({ request, context }) =>
        handle(async () => updateProfile(context.barberId, await readBody(request, profilePatch))),
    },
  },
})
