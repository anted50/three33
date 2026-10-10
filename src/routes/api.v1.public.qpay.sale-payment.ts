import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { env } from '~/lib/server/env'
import { verifyCallbackToken } from '~/lib/server/payments/callback-token'
import { callbackSubject } from '~/lib/server/booking/sales/payments'
import { checkSalePayment } from '~/lib/server/booking/sales/settle'

/**
 * GET|POST /api/v1/public/qpay/sale-payment?payment={id}&t={hmac}
 *
 * QPay's notification for a barber POS payment. Public by necessity, so the
 * body is ignored: it is only a hint to go and ask QPay (checkSalePayment),
 * and `t` — an HMAC over the payment id — keeps strangers from making us ask
 * about payments they didn't come from. Same design as /api/qpay/callback.
 *
 * Auth   HMAC in `t`
 * 200    { ok: true, status }   also on internal errors: QPay retrying
 *                               won't fix our bug, and the barber's screen
 *                               polls /check anyway
 * 400    missing payment id
 * 403    bad token
 */
const paymentId = z.uuid()

export const Route = createFileRoute('/api/v1/public/qpay/sale-payment')({
  server: {
    handlers: {
      GET: ({ request }) => notify(request),
      POST: ({ request }) => notify(request),
    },
  },
})

async function notify(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const parsed = paymentId.safeParse(url.searchParams.get('payment'))
  if (!parsed.success) return Response.json({ ok: false, error: 'missing payment' }, { status: 400 })

  if (!verifyCallbackToken(callbackSubject(parsed.data), url.searchParams.get('t'), env.QPAY_CALLBACK_SECRET)) {
    return Response.json({ ok: false, error: 'bad token' }, { status: 403 })
  }

  try {
    const result = await checkSalePayment(parsed.data)
    return Response.json({ ok: true, status: result.status })
  } catch (error) {
    console.error(`sale payment callback failed for ${parsed.data}`, error)
    return Response.json({ ok: true, status: 'deferred' })
  }
}
