import { createFileRoute } from '@tanstack/react-router'
import { notFound } from '~/lib/server/api/errors'
import { readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getSale } from '~/lib/server/booking/sales/queries'
import { cancelSalePayment } from '~/lib/server/booking/sales/settle'

/**
 * POST /api/v1/barber/sales/{saleId}/payments/{paymentId}/cancel
 *
 * Withdraws a pending QPay invoice — the customer decided to pay another way.
 * QPay is asked once more first: if it was paid after all, it is captured
 * instead and the response says "paid". Frees the amount for another method.
 *
 * Auth   barber (barberOnly)
 * Body   {}
 * 200    { status, checked }   status: failed (withdrawn) | paid
 * 404    NOT_FOUND
 * 409    NOT_PENDING
 */
export const Route = createFileRoute('/api/v1/barber/sales/$saleId/payments/$paymentId/cancel')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ params, context }) =>
        handle(async () => {
          const sale = await getSale(context.barberId, readId(params, 'saleId'))
          const paymentId = readId(params, 'paymentId')
          if (!sale.payments.some((p) => p.id === paymentId)) throw notFound('Payment')
          return cancelSalePayment(paymentId, context.barberId)
        }),
    },
  },
})
