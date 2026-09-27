import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { addPayment, paymentInput } from '~/lib/server/booking/sales/payments'

/**
 * POST /api/v1/barber/sales/{saleId}/payments — take money for a sale
 *
 * Any mix of methods until the sale is covered; each payment may not exceed
 * `remaining`.
 *
 *   cash           paid on entry. You hold this cash: it is owed back to
 *                  the shop (your ledger shows it).
 *   pos            card terminal — paid on entry, on your word; the money
 *   bank_transfer  lands in the shop's account where no API can check it.
 *   qpay           issues a QPay invoice: show invoicePayload.qrImage to the
 *                  customer. It becomes paid only when QPay confirms it —
 *                  poll POST …/payments/{paymentId}/check.
 *
 * When paid payments cover the sale it closes, and an appointment checkout
 * completes its appointment. Each paid payment credits your ledger.
 *
 * Auth   barber (barberOnly)
 * Body   { "method": "cash" | "pos" | "bank_transfer" | "qpay", "amount": mungu }
 * 200    Sale — the new payment is last in `payments`
 * 400    QPay needs whole tugrik (amount divisible by 100)
 * 404    NOT_FOUND
 * 409    SALE_CLOSED, AMOUNT_TOO_HIGH (details.remaining), NO_TERMS
 * 502    QPAY_UNAVAILABLE
 */
export const Route = createFileRoute('/api/v1/barber/sales/$saleId/payments')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ request, params, context }) =>
        handle(async () =>
          addPayment(context.staff, context.barberId, readId(params, 'saleId'), await readBody(request, paymentInput)),
        ),
    },
  },
})
