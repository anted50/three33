import { createFileRoute } from '@tanstack/react-router'
import { notFound } from '~/lib/server/api/errors'
import { readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getSale } from '~/lib/server/booking/sales/queries'
import { checkSalePayment } from '~/lib/server/booking/sales/settle'

/**
 * POST /api/v1/barber/sales/{saleId}/payments/{paymentId}/check
 *
 * Asks QPay whether a pending QPay payment has been paid — the POS screen
 * polls this while the customer scans. Paid payments are captured
 * automatically (ledger written, sale closed if covered). Asks QPay at most
 * every 3 seconds per payment; extra polls just return the current status.
 *
 * Auth   barber (barberOnly)
 * Body   {}
 * 200    { status, checked, outcome? }
 *        status   pending | paid | failed
 *        checked  whether QPay was actually asked this time
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/barber/sales/$saleId/payments/$paymentId/check')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ params, context }) =>
        handle(async () => {
          const sale = await getSale(context.barberId, readId(params, 'saleId'))
          const paymentId = readId(params, 'paymentId')
          if (!sale.payments.some((p) => p.id === paymentId)) throw notFound('Payment')
          return checkSalePayment(paymentId, context.barberId)
        }),
    },
  },
})
