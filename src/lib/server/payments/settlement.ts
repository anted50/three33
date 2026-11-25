import { assert } from '~/lib/assert'
import { assertMungu, fromQpayAmount, fromStorepayAmount, sumMungu, type Mungu } from '~/lib/money'
import type { SettlementResult } from './provider'
import type { QpayPaymentCheckResponse } from './qpay/types'
import type { StorepayCheckByLoanResponse } from './storepay/types'

/**
 * Turns each provider's own "is this paid?" response into a settlement
 * decision.
 *
 * Pure on purpose — no network, no database. This is the single most important
 * piece of logic in the payment flow (it decides whether a customer's order is
 * paid), so these are plain functions Vitest can hammer directly.
 */
export function decideSettlement(
  response: QpayPaymentCheckResponse,
  expected: Mungu,
): SettlementResult {
  assertMungu(expected)
  assert(expected > 0, 'an invoice is never for nothing')
  const paidRows = response.rows.filter((r) => r.payment_status === 'PAID')
  const refundedRows = response.rows.filter(
    (r) => r.payment_status === 'REFUNDED',
  )

  const paidAmount = sumMungu(paidRows.map((row) => fromQpayAmount(row.payment_amount)))

  /**
   * A refunded row never counts toward the paid amount, wherever it sits in
   * the array. The outcome is `refunded` only when nothing paid is left;
   * a payment that still stands next to a refunded one is judged on its own
   * amount below.
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
    // The first PAID row is what goes in payments.payment_id, which
    // carries the unique index that makes callback/reconcile races safe.
    providerPaymentId: paidRows[0]!.payment_id,
    raw: response,
  }
}

/**
 * Turns a StorePay loan/check response into a settlement decision.
 *
 * Unlike QPay, a StorePay loan has no partial-payment concept — the customer
 * either confirmed the installment for the full amount or they didn't — so
 * there is no `refunded`/multi-row summing to do here. `underpaid` is kept
 * for the theoretical case where StorePay confirms a loan for less than we
 * asked, so that case still surfaces to a human rather than silently shipping.
 *
 * `loanId` is threaded through rather than read off the response because
 * StorePay has no separate "payment id" the way QPay does — the loan id is
 * the only reference for payments_payment_id_key's idempotency guard.
 */
export function decideStorepaySettlement(
  response: StorepayCheckByLoanResponse,
  loanId: string,
  expected: Mungu,
): SettlementResult {
  assertMungu(expected)
  assert(expected > 0, 'an invoice is never for nothing')
  const data = response.data

  if (!data?.isExist) {
    return { outcome: 'unpaid', paidAmount: 0, providerPaymentId: null, raw: response }
  }

  if (!data.isConfirmed) {
    return { outcome: 'unpaid', paidAmount: 0, providerPaymentId: null, raw: response }
  }

  // Confirmed but no amount to check it against: don't ship on faith. The
  // underpaid path leaves the order pending for a human instead.
  if (data.amount === undefined) {
    return { outcome: 'underpaid', paidAmount: 0, providerPaymentId: null, raw: response }
  }

  const paidAmount = fromStorepayAmount(data.amount)
  const outcome = paidAmount >= expected ? 'paid' : 'underpaid'

  return { outcome, paidAmount, providerPaymentId: loanId, raw: response }
}
