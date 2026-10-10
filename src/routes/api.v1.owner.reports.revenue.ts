import { createFileRoute } from '@tanstack/react-router'
import { readQuery } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { revenueQuery, revenueReport } from '~/lib/server/booking/reports/revenue'

/**
 * GET /api/v1/owner/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * E-commerce versus the shop floor, for any range up to a year (Ulaanbaatar
 * days, inclusive). Revenue, not profit — product cost prices aren't stored.
 *
 *   totals           ecommerce (online goods), inStoreProducts, products
 *                    (both), services, shipping, all
 *   ecommerce        { orders, goods, shipping, total } — online shop orders
 *                    by the day their payment landed
 *   inStoreProducts  { total, units } — products sold through the POS
 *   services         { total, bookingFees, appointments, walkIns }
 *                    fees count the day they were paid online; the rest the
 *                    day the POS sale closed (never counting a fee twice)
 *   byLocation       [{ id, name, products, services }]   shop floor only
 *   byBarber         [{ id, name, products, services }]   shop floor only
 *   byMethod         { qpay, cash, pos, bank_transfer } — money that arrived
 *                    in the range, every channel: reconcile the drawer and
 *                    bank against this
 *   days             [{ date, ecommerce, inStoreProducts, services }]
 *
 * Auth   owner (ownerOnly). Money is integer mungu.
 * 400    range backwards or longer than a year
 */
export const Route = createFileRoute('/api/v1/owner/reports/revenue')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: ({ request }) => handle(() => revenueReport(readQuery(request, revenueQuery))),
    },
  },
})
