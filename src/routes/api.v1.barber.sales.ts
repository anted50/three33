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
 * POST  Ring up a sale of free-form lines: any name, description and amount
 *       — a friend's discount, a one-off service. A line may point at one of
 *       your services (serviceId) for reporting; its amount is still yours to
 *       set. Take payment next with POST /sales/{saleId}/payments.
 *       A sale totalling 0 is closed immediately.
 *       Body { locationId,
 *              lines: [{ serviceId?, name, description?, unitAmount, qty? }],
 *              note?, customerName?, customerPhone?, customerEmail? }
 *       201  Sale — { …, lines, payments, due, paid, pending, remaining }
 *       400  a line names a service that isn't yours
 *       403  not assigned to that location
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
