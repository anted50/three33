import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { voidSale } from '~/lib/server/booking/sales/void'

/**
 * POST /api/v1/barber/sales/{saleId}/void — abandon an unpaid sale
 *
 * Only while no money has been taken. Pending QPay invoices are withdrawn
 * first; if one turns out to have been paid, it is settled and the void is
 * refused. Voiding an appointment's checkout lets you cancel or re-open it.
 *
 * Auth   barber (barberOnly)
 * Body   {}
 * 200    Sale
 * 404    NOT_FOUND
 * 409    SALE_CLOSED, HAS_PAYMENTS
 */
export const Route = createFileRoute('/api/v1/barber/sales/$saleId/void')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ params, context }) => handle(() => voidSale(context.barberId, readId(params, 'saleId'))),
    },
  },
})
