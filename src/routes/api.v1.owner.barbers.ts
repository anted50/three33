import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { createBarber, createBarberInput, listBarbers } from '~/lib/server/booking/barbers'

/**
 * /api/v1/owner/barbers — the owner's barber list and "new barber" form
 *
 * GET   Every barber with login email, locations and current terms.
 *       200  Barber[]
 *
 * POST  Create a barber AND their login in one step. There is no signup:
 *       this is the only way a barber account comes to exist. The barber
 *       then signs in with an emailed code at /api/v1/auth/code.
 *       An existing user with the same email (e.g. the owner) is reused.
 *       Body {
 *         email, name, phone,                       required
 *         slug?, bioMn?, bioEn?, photoUrl?,
 *         bookingFee?, bufferMinutes?, sortOrder?,
 *         locationIds: [uuid, …],                   at least one
 *         terms?: { serviceCutBps, productCommissionBps?, rentAmount?,
 *                   rentPeriod?, rentStartsOn?, effectiveFrom? }
 *       }
 *       Terms are optional (on hold while the owner is the only barber):
 *       without them the barber keeps everything — 0% cut, 0% commission.
 *       To set yourself up as the barber, use your own email: your user is
 *       reused and gains a barber profile.
 *       201  Barber
 *       400  VALIDATION / unknown location
 *       409  EMAIL_TAKEN, SLUG_TAKEN, ALREADY_BARBER
 *
 * Auth  owner (ownerOnly). Money is integer mungu; bps: 3000 = 30%.
 */
export const Route = createFileRoute('/api/v1/owner/barbers')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: () => handle(() => listBarbers()),
      POST: ({ request, context }) =>
        handle(async () => createBarber(await readBody(request, createBarberInput), context.staff.userId), 201),
    },
  },
})
