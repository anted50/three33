import { createFileRoute } from '@tanstack/react-router'
import { readQuery } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { listAllSales, ownerSalesQuery } from '~/lib/server/booking/oversight'

/**
 * GET /api/v1/owner/sales — every POS sale, across barbers and locations
 *
 * Read-only, newest first, up to 500. Open one for its lines and payments
 * with GET /owner/sales/{saleId}.
 *
 * Auth   owner (ownerOnly)
 * Query  from?, to? (YYYY-MM-DD, by when rung up); barberId?; locationId?;
 *        status? (open | paid | void)
 * 200    [Sale & { barberName, locationName }]
 */
export const Route = createFileRoute('/api/v1/owner/sales')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: ({ request }) => handle(() => listAllSales(readQuery(request, ownerSalesQuery))),
    },
  },
})
