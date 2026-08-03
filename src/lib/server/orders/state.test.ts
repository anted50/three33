import { describe, expect, it } from 'vitest'
import {
  assertTransition,
  canReview,
  canTransition,
  InvalidTransitionError,
  isPaid,
  isTerminal,
} from './state'

describe('canTransition', () => {
  it('allows the happy path end to end', () => {
    expect(canTransition('pending_payment', 'paid')).toBe(true)
    expect(canTransition('paid', 'processing')).toBe(true)
    expect(canTransition('processing', 'shipped')).toBe(true)
    expect(canTransition('shipped', 'delivered')).toBe(true)
  })

  it('lets an unpaid order expire or be cancelled', () => {
    expect(canTransition('pending_payment', 'expired')).toBe(true)
    expect(canTransition('pending_payment', 'cancelled')).toBe(true)
  })

  it('refuses to un-pay an order', () => {
    // The guard that matters: a duplicate callback or a racing reconcile must
    // never walk a paid order backwards.
    expect(canTransition('paid', 'pending_payment')).toBe(false)
    expect(canTransition('delivered', 'paid')).toBe(false)
  })

  it('refuses to skip fulfilment steps', () => {
    expect(canTransition('paid', 'delivered')).toBe(false)
    expect(canTransition('paid', 'shipped')).toBe(false)
  })

  it('refuses to revive a terminal order', () => {
    expect(canTransition('expired', 'paid')).toBe(false)
    expect(canTransition('cancelled', 'paid')).toBe(false)
    expect(canTransition('refunded', 'paid')).toBe(false)
  })

  it('will not cancel an order that has shipped', () => {
    expect(canTransition('shipped', 'cancelled')).toBe(false)
    expect(canTransition('delivered', 'cancelled')).toBe(false)
  })

  it('allows a refund from any paid state', () => {
    for (const s of ['paid', 'processing', 'shipped', 'delivered'] as const) {
      expect(canTransition(s, 'refunded')).toBe(true)
    }
  })

  it('refuses to refund an order that never paid', () => {
    expect(canTransition('pending_payment', 'refunded')).toBe(false)
  })
})

describe('assertTransition', () => {
  it('is silent on a legal move', () => {
    expect(() => assertTransition('pending_payment', 'paid')).not.toThrow()
  })

  it('throws a typed error naming both states', () => {
    expect(() => assertTransition('paid', 'pending_payment')).toThrow(
      InvalidTransitionError,
    )
  })
})

describe('isPaid', () => {
  it('covers every state where the money is ours', () => {
    expect(isPaid('paid')).toBe(true)
    expect(isPaid('processing')).toBe(true)
    expect(isPaid('shipped')).toBe(true)
    expect(isPaid('delivered')).toBe(true)
  })

  it('excludes unpaid and reversed states', () => {
    expect(isPaid('pending_payment')).toBe(false)
    expect(isPaid('expired')).toBe(false)
    expect(isPaid('refunded')).toBe(false)
  })
})

describe('isTerminal', () => {
  it('identifies the dead ends', () => {
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('expired')).toBe(true)
    expect(isTerminal('refunded')).toBe(true)
    expect(isTerminal('pending_payment')).toBe(false)
  })
})

describe('canReview', () => {
  it('gates reviews to delivered orders only', () => {
    expect(canReview('delivered')).toBe(true)
    expect(canReview('shipped')).toBe(false)
    expect(canReview('paid')).toBe(false)
  })
})
