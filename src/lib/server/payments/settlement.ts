import { fromQpayAmount, type Mungu } from '~/lib/money'
import type { SettlementResult } from './provider'
import type { QpayPaymentCheckResponse } from './qpay/types'

/**
 * Turns a QPay payment/check response into a settlement decision.
 *
 * Pure on purpose — no network, no database. This is the single most important
 * piece of logic in the payment flow (it decides whether a customer's order is
 * paid), so it is a plain function that Vitest can hammer directly.
 */
export function decideSettlement(
  response: QpayPaymentCheckResponse,
  expected: Mungu,
): SettlementResult {
  const paidRows = response.rows.filter((r) => r.payment_status === 'PAID')
  const refundedRows = response.rows.filter(
    (r) => r.payment_status === 'REFUNDED',
  )

  const paidAmount = paidRows.reduce(
    (sum, row) => sum + fromQpayAmount(row.payment_amount),
    0,
  )

  /**
   * A refund reverses a payment, so refunds win over paid rows regardless of
   * order in the array. Reporting `paid` here would let a refunded order ship.
   */
  if (refundedRows.length > 0 && paidRows.length === 0) {
    return {
      outcome: 'refunded',
      paidAmount: 0,
      providerPaymentId: refundedRows[0]!.payment_id,
      raw: response,
    }
  }

  if (paidRows.length === 0) {
    return {
      outcome: 'unpaid',
      paidAmount: 0,
      providerPaymentId: null,
      raw: response,
    }
  }

  /**
   * `>=` not `===`: QPay invoices can be created with allow_exceed, and a
   * customer who overpays has still paid. Refusing to settle an overpayment
   * would strand a real order. Under-payment is the case that needs a human.
   */
  const outcome = paidAmount >= expected ? 'paid' : 'underpaid'

  return {
    outcome,
    paidAmount,
    // The first PAID row is what goes in payments.qpay_payment_id, which
    // carries the unique index that makes callback/reconcile races safe.
    providerPaymentId: paidRows[0]!.payment_id,
    raw: response,
  }
}
