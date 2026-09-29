import { describe, expect, it } from 'vitest'
import { tugrikToMungu } from '~/lib/money'
import { decideSettlement, decideStorepaySettlement } from './settlement'
import type { QpayPaymentCheckResponse } from './qpay/types'
import type { StorepayCheckByLoanResponse } from './storepay/types'

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

  it('ignores NEW, FAILED and PARTIAL rows', () => {
    const result = decideSettlement(
      check([
        { id: 'a', status: 'NEW', amount: 45_000 },
        { id: 'b', status: 'FAILED', amount: 45_000 },
        { id: 'c', status: 'PARTIAL', amount: 45_000 },
      ]),
      TOTAL,
    )
    expect(result.outcome).toBe('unpaid')
    expect(result.paidAmount).toBe(0)
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
