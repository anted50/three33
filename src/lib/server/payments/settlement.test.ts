import { describe, expect, it } from 'vitest'
import { tugrikToMungu } from '~/lib/money'
import { decideSettlement, decideStorepaySettlement } from './settlement'
import type { QpayPaymentCheckResponse } from './qpay/types'
import {
  storepayCheckByLoanResponse,
  type StorepayCheckByLoanResponse,
} from './storepay/types'

const TOTAL = tugrikToMungu(45_000)

function check(
  rows: Array<{ id: string; status: string; amount: number }>,
): QpayPaymentCheckResponse {
  return {
    count: rows.length,
    paid_amount: rows.reduce((s, r) => s + r.amount, 0),
    rows: rows.map((r) => ({
      payment_id: r.id,
      payment_status: r.status as never,
      payment_amount: r.amount,
      payment_currency: 'MNT',
      payment_wallet: null,
      payment_type: 'P2P',
      payment_date: null,
    })),
  }
}

describe('decideSettlement', () => {
  it('reports unpaid for an untouched invoice', () => {
    const result = decideSettlement(check([]), TOTAL)
    expect(result.outcome).toBe('unpaid')
    expect(result.paidAmount).toBe(0)
    expect(result.providerPaymentId).toBeNull()
  })

  it('settles when the full amount is paid', () => {
    const result = decideSettlement(
      check([{ id: '493622150113497', status: 'PAID', amount: 45_000 }]),
      TOTAL,
    )
    expect(result.outcome).toBe('paid')
    expect(result.paidAmount).toBe(TOTAL)
    expect(result.providerPaymentId).toBe('493622150113497')
  })

  it('sums multiple paid rows before deciding', () => {
    // allow_partial invoices settle across several transactions.
    const result = decideSettlement(
      check([
        { id: 'a', status: 'PAID', amount: 20_000 },
        { id: 'b', status: 'PAID', amount: 25_000 },
      ]),
      TOTAL,
    )
    expect(result.outcome).toBe('paid')
    expect(result.paidAmount).toBe(TOTAL)
  })

  it('flags underpayment rather than settling it', () => {
    const result = decideSettlement(
      check([{ id: 'a', status: 'PAID', amount: 44_999 }]),
      TOTAL,
    )
    expect(result.outcome).toBe('underpaid')
    expect(result.paidAmount).toBe(tugrikToMungu(44_999))
  })

  it('settles an overpayment instead of stranding the order', () => {
    const result = decideSettlement(
      check([{ id: 'a', status: 'PAID', amount: 50_000 }]),
      TOTAL,
    )
    expect(result.outcome).toBe('paid')
  })

  it('ignores NEW and FAILED rows', () => {
    const result = decideSettlement(
      check([
        { id: 'a', status: 'NEW', amount: 45_000 },
        { id: 'b', status: 'FAILED', amount: 45_000 },
      ]),
      TOTAL,
    )
    expect(result.outcome).toBe('unpaid')
    expect(result.paidAmount).toBe(0)
  })

  it('sends a PARTIAL payment to a human instead of letting it expire', () => {
    // Goal: money that arrived in part must never read as "unpaid", which
    // the sweep expires. Method: one PARTIAL row and nothing else.
    const result = decideSettlement(
      check([{ id: 'p', status: 'PARTIAL', amount: 20_000 }]),
      TOTAL,
    )
    expect(result.outcome).toBe('underpaid')
    expect(result.paidAmount).toBe(tugrikToMungu(20_000))
    expect(result.providerPaymentId).toBe('p')
  })

  it('counts a PARTIAL row toward what arrived, not toward settling', () => {
    // Goal: only fully PAID rows can settle an order. Method: a short PAID
    // row plus a PARTIAL row that together reach the total.
    const result = decideSettlement(
      check([
        { id: 'a', status: 'PAID', amount: 25_000 },
        { id: 'b', status: 'PARTIAL', amount: 20_000 },
      ]),
      TOTAL,
    )
    expect(result.outcome).toBe('underpaid')
    expect(result.paidAmount).toBe(TOTAL)
  })

  it('settles on PAID rows even when a PARTIAL row sits beside them', () => {
    const result = decideSettlement(
      check([
        { id: 'a', status: 'PARTIAL', amount: 5_000 },
        { id: 'b', status: 'PAID', amount: 45_000 },
      ]),
      TOTAL,
    )
    expect(result.outcome).toBe('paid')
    expect(result.paidAmount).toBe(TOTAL)
    expect(result.providerPaymentId).toBe('b')
  })

  it('reports refunded when the only row is a reversal', () => {
    const result = decideSettlement(
      check([{ id: 'a', status: 'REFUNDED', amount: 45_000 }]),
      TOTAL,
    )
    expect(result.outcome).toBe('refunded')
    expect(result.paidAmount).toBe(0)
    expect(result.providerPaymentId).toBe('a')
  })

  it('converts tugrik to mungu rather than comparing raw provider numbers', () => {
    // The bug this guards: comparing 45000 (tugrik) against 4500000 (mungu)
    // and concluding the customer underpaid by 100x.
    const result = decideSettlement(
      check([{ id: 'a', status: 'PAID', amount: 45_000 }]),
      TOTAL,
    )
    expect(result.paidAmount).toBe(4_500_000)
  })

  it('keeps the raw response for the audit column', () => {
    const response = check([{ id: 'a', status: 'PAID', amount: 45_000 }])
    expect(decideSettlement(response, TOTAL).raw).toBe(response)
  })
})

function loanCheck(
  data: {
    isExist: boolean
    isConfirmed: boolean
    amount: number
  } | null,
): StorepayCheckByLoanResponse {
  return {
    value: data?.isConfirmed ?? null,
    data: data
      ? {
          loanId: '2248245',
          status: data.isConfirmed ? 'confirmed' : 'pending',
          amount: data.amount,
          description: 'test',
          storeId: '27512',
          number: 'L1340177729',
          isExist: data.isExist,
          isConfirmed: data.isConfirmed,
        }
      : null,
    msgList: [],
    attrs: null,
    status: 'Success',
  }
}

describe('decideStorepaySettlement', () => {
  it('parses and settles StorePay’s real reply for an unknown loan', () => {
    // Verbatim from GET /merchant/loan/check/1 on 2026-09-29: no loanId, no
    // status, no amount, and an envelope status of "Error". This used to
    // throw in the parser, so such an order could never expire.
    const reply = storepayCheckByLoanResponse.parse({
      value: false,
      data: { isExist: false, isConfirmed: false },
      msgList: [],
      attrs: {},
      status: 'Error',
    })
    expect(decideStorepaySettlement(reply, '1', TOTAL).outcome).toBe('unpaid')
  })

  it('sends a confirmed loan with no amount to a human, not to "paid"', () => {
    const reply = storepayCheckByLoanResponse.parse({
      value: true,
      data: { isExist: true, isConfirmed: true },
      msgList: [],
      status: 'Success',
    })
    const result = decideStorepaySettlement(reply, '2248245', TOTAL)
    expect(result.outcome).toBe('underpaid')
    expect(result.providerPaymentId).toBeNull()
  })

  it('reports unpaid when the loan does not exist', () => {
    const result = decideStorepaySettlement(loanCheck(null), '2248245', TOTAL)
    expect(result.outcome).toBe('unpaid')
    expect(result.paidAmount).toBe(0)
    expect(result.providerPaymentId).toBeNull()
  })

  it('reports unpaid for a loan that exists but is not yet confirmed', () => {
    const result = decideStorepaySettlement(
      loanCheck({ isExist: true, isConfirmed: false, amount: 45_000 }),
      '2248245',
      TOTAL,
    )
    expect(result.outcome).toBe('unpaid')
    expect(result.providerPaymentId).toBeNull()
  })

  it('settles a confirmed loan for the full amount', () => {
    const result = decideStorepaySettlement(
      loanCheck({ isExist: true, isConfirmed: true, amount: 45_000 }),
      '2248245',
      TOTAL,
    )
    expect(result.outcome).toBe('paid')
    expect(result.paidAmount).toBe(TOTAL)
    // The loan id, not a separate payment id — StorePay has no such thing.
    expect(result.providerPaymentId).toBe('2248245')
  })

  it('flags underpayment rather than settling it', () => {
    const result = decideStorepaySettlement(
      loanCheck({ isExist: true, isConfirmed: true, amount: 44_999 }),
      '2248245',
      TOTAL,
    )
    expect(result.outcome).toBe('underpaid')
  })

  it('settles an overpayment instead of stranding the order', () => {
    const result = decideStorepaySettlement(
      loanCheck({ isExist: true, isConfirmed: true, amount: 50_000 }),
      '2248245',
      TOTAL,
    )
    expect(result.outcome).toBe('paid')
  })

  it('converts tugrik to mungu rather than comparing raw provider numbers', () => {
    const result = decideStorepaySettlement(
      loanCheck({ isExist: true, isConfirmed: true, amount: 45_000 }),
      '2248245',
      TOTAL,
    )
    expect(result.paidAmount).toBe(4_500_000)
  })

  it('keeps the raw response for the audit column', () => {
    const response = loanCheck({ isExist: true, isConfirmed: true, amount: 45_000 })
    expect(decideStorepaySettlement(response, '2248245', TOTAL).raw).toBe(response)
  })
})
