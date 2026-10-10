import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getSale } from '~/lib/server/booking/sales/queries'

/**
 * GET /api/v1/barber/sales/{saleId} — one sale with its lines and payments
 *
 *   due        total − credit (credit = booking fee already paid online)
 *   paid       confirmed so far
 *   pending    QPay invoices waiting to be paid
 *   remaining  what can still be charged
 *
 * Auth   barber (barberOnly) — only your own
 * 200    Sale — { …, lines, payments, due, paid, pending, remaining }
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/barber/sales/$saleId')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ params, context }) => handle(() => getSale(context.barberId, readId(params, 'saleId'))),
    },
  },
})
