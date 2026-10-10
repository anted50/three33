import { createFileRoute } from '@tanstack/react-router'
import { env } from '~/lib/server/env'
import {
  cleanPathToken,
  verifyCallbackToken,
} from '~/lib/server/payments/callback-token'
import { settleOrder } from '~/lib/server/orders/settle'

/**
 * StorePay's loan-confirmation notification endpoint:
 * /api/storepay/callback/<orderNo>/<token>. Public by necessity — StorePay has
 * to reach it, so anyone can.
 *
 * Order and token live in the path because StorePay appends `?id=<loanId>` to
 * the URL it is given (see buildPathCallbackUrl); in a query string that
 * corrupted the token. Whatever it appends is ignored here.
 *
 * Same discipline as the QPay callback (api.qpay.callback.tsx): the request
 * itself is only a hint. settleOrder independently calls /merchant/loan/check
 * and settles from that, so a forged callback achieves nothing beyond costing
 * one API call, which the HMAC makes hard.
 *
 * Always returns 200 on anything StorePay could retry. A non-200 makes
 * StorePay retry a callback we have already handled correctly, and the settle
 * path is idempotent anyway.
 */
export const Route = createFileRoute('/api/storepay/callback/$orderNo/$token')({
  server: {
    handlers: {
      GET: ({ params }) => handle(params.orderNo, params.token),
      POST: ({ params }) => handle(params.orderNo, params.token),
    },
  },
})

async function handle(orderNo: string, token: string): Promise<Response> {
  if (!env.STOREPAY_CALLBACK_SECRET) {
    console.error('storepay callback received but STOREPAY_CALLBACK_SECRET is unset')
    return Response.json({ ok: false, error: 'not configured' }, { status: 500 })
  }

  if (!verifyCallbackToken(orderNo, cleanPathToken(token), env.STOREPAY_CALLBACK_SECRET)) {
    // 403, not 200: this was not StorePay, so there is nothing to retry.
    return Response.json({ ok: false, error: 'bad token' }, { status: 403 })
  }

  try {
    const outcome = await settleOrder(orderNo)
    return Response.json({ ok: true, outcome })
  } catch (error) {
    // Swallow and 200: StorePay retrying will not fix a bug on our side, and
    // the hourly reconciliation sweep is the real safety net.
    console.error(`storepay callback failed for ${orderNo}`, error)
    return Response.json({ ok: true, outcome: 'deferred' })
  }
}
