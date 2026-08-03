import { describe, expect, it } from 'vitest'
import { tugrikToMungu } from '~/lib/money'
import {
  clampQty,
  computeTotals,
  zoneForDistrict,
  type ShippingRates,
} from './pricing'

const RATES: ShippingRates = {
  ub: tugrikToMungu(5_000),
  countryside: tugrikToMungu(15_000),
  freeUbThreshold: tugrikToMungu(50_000),
}

const line = (price: number, qty: number) => ({
  variantId: 'v1',
  unitPrice: tugrikToMungu(price),
  qty,
})

describe('zoneForDistrict', () => {
  it('treats the nine UB districts as the city zone', () => {
    expect(zoneForDistrict('Хан-Уул')).toBe('ub')
    expect(zoneForDistrict('Баянзүрх')).toBe('ub')
  })

  it('treats anything else as countryside', () => {
    expect(zoneForDistrict('Дархан')).toBe('countryside')
    expect(zoneForDistrict('')).toBe('countryside')
  })
})

describe('computeTotals', () => {
  it('sums lines and adds UB shipping below the free threshold', () => {
    const totals = computeTotals([line(20_000, 2)], 'ub', RATES)
    expect(totals.subtotal).toBe(tugrikToMungu(40_000))
    expect(totals.shippingFee).toBe(tugrikToMungu(5_000))
    expect(totals.total).toBe(tugrikToMungu(45_000))
  })

  it('ships free within UB at exactly the threshold', () => {
    // Boundary: >= not >, or a 50,000 order pays delivery the site promised
    // it would not.
    const totals = computeTotals([line(50_000, 1)], 'ub', RATES)
    expect(totals.shippingFee).toBe(0)
    expect(totals.total).toBe(tugrikToMungu(50_000))
  })

  it('never ships countryside free, however large the order', () => {
    const totals = computeTotals([line(500_000, 1)], 'countryside', RATES)
    expect(totals.shippingFee).toBe(tugrikToMungu(15_000))
  })

  it('charges no delivery on an empty cart', () => {
    const totals = computeTotals([], 'countryside', RATES)
    expect(totals).toEqual({ subtotal: 0, shippingFee: 0, total: 0 })
  })

  it('multiplies each line by its own quantity', () => {
    const totals = computeTotals(
      [line(45_000, 2), line(85_000, 1)],
      'ub',
      RATES,
    )
    expect(totals.subtotal).toBe(tugrikToMungu(175_000))
  })

  it('keeps everything in integer mungu', () => {
    const totals = computeTotals([line(45_000, 3)], 'ub', RATES)
    expect(Number.isInteger(totals.total)).toBe(true)
    expect(totals.subtotal).toBe(13_500_000)
  })

  it('rejects a fractional quantity rather than rounding it', () => {
    expect(() =>
      computeTotals([{ variantId: 'v', unitPrice: 100, qty: 1.5 }], 'ub', RATES),
    ).toThrow()
  })
})

describe('clampQty', () => {
  it('passes through a quantity that is in stock', () => {
    expect(clampQty(3, 10)).toBe(3)
  })

  it('clamps to available stock rather than overselling', () => {
    expect(clampQty(10, 3)).toBe(3)
  })

  it('returns 0 for an out-of-stock variant', () => {
    expect(clampQty(1, 0)).toBe(0)
  })

  it('rejects zero, negative and fractional requests', () => {
    expect(clampQty(0, 10)).toBe(0)
    expect(clampQty(-5, 10)).toBe(0)
    expect(clampQty(1.5, 10)).toBe(0)
  })
})
