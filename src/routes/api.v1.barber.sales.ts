import { createFileRoute } from '@tanstack/react-router'
import { readBody, readQuery } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { createSale, saleInput } from '~/lib/server/booking/sales/create'
import { listSales, salesQuery } from '~/lib/server/booking/sales/queries'

/**
 * /api/v1/barber/sales — the barber's POS
 *
 * GET   Recent sales (newest first, up to 200).
 *       Query from?, to? (YYYY-MM-DD), status? (open | paid | void)
 *       200  Sale[]
 *
 * POST  Ring up a sale. Two kinds of line, freely mixed:
 *         product  { variantId, qty? }  the owner's listed price, name and
 *                  sku — not yours to change (catalog: GET /barber/products).
 *                  Stock is checked now and deducted when the sale is paid.
 *         free     { name, unitAmount, qty?, description?, serviceId? }
 *                  any name and amount — a friend's discount, a one-off
 *                  service; serviceId only links one of your services.
 *       Take payment next with POST /sales/{saleId}/payments.
 *       A sale totalling 0 is closed immediately.
 *       Body { locationId, lines: [line, …],
 *              note?, customerName?, customerPhone?, customerEmail? }
 *       201  Sale — { …, lines, payments, due, paid, pending, remaining }
 *       400  a product not for sale, or a service that isn't yours
 *       403  not assigned to that location
 *       409  OUT_OF_STOCK (details: { sku, inStock })
 *
 * Auth  barber (barberOnly). Money is integer mungu.
 */
export const Route = createFileRoute('/api/v1/barber/sales')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ request, context }) => handle(() => listSales(context.barberId, readQuery(request, salesQuery))),
      POST: ({ request, context }) =>
        handle(async () => createSale(context.staff, context.barberId, await readBody(request, saleInput)), 201),
    },
  },
})
