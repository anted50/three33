import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getBarber } from '~/lib/server/booking/barbers'
import { addTerms, termsInput } from '~/lib/server/booking/terms'

/**
 * POST /api/v1/owner/barbers/{barberId}/terms — change the barber's deal
 *
 * Adds a NEW version; old ones are never edited, so past ledger rows keep the
 * rate they were earned at. It applies from effectiveFrom (default now).
 * Commission and rent can both apply at once.
 *
 * Auth   owner (ownerOnly)
 * Body   { serviceCutBps,              shop's cut of services, 3000 = 30%
 *          productCommissionBps?,      barber's cut of product sales
 *          rentAmount?,                mungu; 0 = no rent
 *          rentPeriod?,                weekly | biweekly | monthly
 *          rentStartsOn?,              YYYY-MM-DD, first due date
 *          effectiveFrom? }            ISO datetime; default now
 * 201    BarberTerms
 * 404    NOT_FOUND
 * 409    TERMS_EXIST  (another version starts at that exact moment)
 */
export const Route = createFileRoute('/api/v1/owner/barbers/$barberId/terms')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      POST: ({ request, params, context }) =>
        handle(async () => {
          const barberId = readId(params, 'barberId')
          await getBarber(barberId)
          return addTerms(barberId, await readBody(request, termsInput), context.staff.userId)
        }, 201),
    },
  },
})
