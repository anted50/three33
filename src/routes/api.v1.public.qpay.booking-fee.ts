import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { feeCallbackSubject } from '~/lib/server/booking/book'
import { checkBookingFee } from '~/lib/server/booking/fee'
import { env } from '~/lib/server/env'
import { verifyCallbackToken } from '~/lib/server/payments/callback-token'

/**
 * GET|POST /api/v1/public/qpay/booking-fee?appointment={id}&t={hmac}
 *
 * QPay's notification for a booking fee. The body is ignored — it is only a
 * hint to ask QPay directly (checkBookingFee) — and `t`, an HMAC over the
 * appointment id, keeps strangers from triggering checks. Same design as
 * /api/qpay/callback.
 *
 * Auth   HMAC in `t`
 * 200    { ok: true, status }   also on internal errors (the page polls and
 *                               the sweep checks anyway)
 * 400    missing appointment id
 * 403    bad token
 */
const appointmentId = z.uuid()

export const Route = createFileRoute('/api/v1/public/qpay/booking-fee')({
  server: {
    handlers: {
      GET: ({ request }) => notify(request),
      POST: ({ request }) => notify(request),
    },
  },
})

async function notify(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const parsed = appointmentId.safeParse(url.searchParams.get('appointment'))
  if (!parsed.success) return Response.json({ ok: false, error: 'missing appointment' }, { status: 400 })

  if (!verifyCallbackToken(feeCallbackSubject(parsed.data), url.searchParams.get('t'), env.QPAY_CALLBACK_SECRET)) {
    return Response.json({ ok: false, error: 'bad token' }, { status: 403 })
  }

  try {
    const result = await checkBookingFee(parsed.data)
    return Response.json({ ok: true, status: result.status })
  } catch (error) {
    console.error(`booking fee callback failed for ${parsed.data}`, error)
    return Response.json({ ok: true, status: 'deferred' })
  }
}
