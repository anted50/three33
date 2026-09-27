import { createFileRoute } from '@tanstack/react-router'
import { readBody, readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { checkoutInput, startCheckout } from '~/lib/server/booking/appointments/checkout'

/**
 * POST /api/v1/barber/appointments/{appointmentId}/checkout
 *
 * "Service finished — take the money." Opens a POS sale for the booking:
 * lines default to what was booked, or send your own (added a beard trim,
 * charged a friend less). The booking fee paid online is the sale's credit,
 * so only the rest is due. Then take payment with
 * POST /api/v1/barber/sales/{saleId}/payments; once the payments cover it,
 * the appointment is completed automatically. Calling this again returns
 * the checkout already open.
 *
 * Auth   barber (barberOnly)
 * Body   { "lines"?: [{ serviceId?, name, description?, unitAmount, qty? }],
 *          "note"?: "…" }
 * 200    Sale — { …, lines, payments, due, paid, pending, remaining }
 * 400    total below the booking fee already paid
 * 404    NOT_FOUND
 * 409    NOT_BOOKED
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId/checkout')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ request, params, context }) =>
        handle(async () =>
          startCheckout(context.staff, context.barberId, readId(params, 'appointmentId'), await readBody(request, checkoutInput)),
        ),
    },
  },
})
