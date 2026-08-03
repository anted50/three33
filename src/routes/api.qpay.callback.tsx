import { createFileRoute } from '@tanstack/react-router'
import { env } from '~/lib/server/env'
import { verifyCallbackToken } from '~/lib/server/payments/callback-token'
import { settleOrder } from '~/lib/server/orders/settle'

/**
 * QPay's payment notification endpoint. Public by necessity — QPay has to reach
 * it, so anyone can.
 *
 * The body is ignored entirely. It is a hint that something happened, nothing
 * more; settleOrder independently calls payment/check and settles from that.
 * A forged callback therefore achieves nothing beyond costing us one API call,
 * which the HMAC on `t` already makes hard.
 *
 * Always returns 200 on anything QPay could retry. A non-200 makes QPay retry
 * a callback we have already handled correctly, and the settle path is
 * idempotent anyway.
 */
export const Route = createFileRoute('/api/qpay/callback')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const orderNo = url.searchParams.get('order')
  const token = url.searchParams.get('t')

  if (!orderNo) {
    return Response.json({ ok: false, error: 'missing order' }, { status: 400 })
  }

  if (!verifyCallbackToken(orderNo, token, env.QPAY_CALLBACK_SECRET)) {
    // 403, not 200: this was not QPay, so there is nothing to retry.
    return Response.json({ ok: false, error: 'bad token' }, { status: 403 })
  }

  try {
    const outcome = await settleOrder(orderNo)
    return Response.json({ ok: true, outcome })
  } catch (error) {
    // Swallow and 200: QPay retrying will not fix a bug on our side, and the
    // hourly reconciliation sweep is the real safety net.
    console.error(`qpay callback failed for ${orderNo}`, error)
    return Response.json({ ok: true, outcome: 'deferred' })
  }
}
