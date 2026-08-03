import { describe, expect, it } from 'vitest'
import {
  formatMnt,
  fromQpayAmount,
  lineTotal,
  munguToTugrik,
  sumMungu,
  toQpayAmount,
  tugrikToMungu,
} from './money'

describe('tugrik <-> mungu', () => {
  it('round-trips whole tugrik', () => {
    expect(tugrikToMungu(1500)).toBe(150_000)
    expect(munguToTugrik(150_000)).toBe(1500)
  })

  it('does not accumulate float error the way naive multiplication does', () => {
    // 0.1 + 0.2 !== 0.3 in floats; integers make the question moot.
    expect(sumMungu([10, 20])).toBe(30)
  })
})

describe('formatMnt', () => {
  it('formats with thousands separators and a trailing tugrik sign', () => {
    expect(formatMnt(1_250_000)).toBe('12,500₮')
    expect(formatMnt(0)).toBe('0₮')
  })

  it('rejects non-integer input rather than silently rounding', () => {
    expect(() => formatMnt(12.5)).toThrow(TypeError)
  })
})

describe('QPay boundary', () => {
  it('sends tugrik, not mungu', () => {
    expect(toQpayAmount(150_000)).toBe(1500)
  })

  it('refuses to invoice a sub-tugrik amount', () => {
    // QPay has no way to express this, so failing loudly beats rounding.
    expect(() => toQpayAmount(150_050)).toThrow(RangeError)
  })

  it('reads tugrik back as mungu', () => {
    expect(fromQpayAmount(1500)).toBe(150_000)
  })

  it('throws on a non-numeric amount from the provider', () => {
    expect(() => fromQpayAmount('1500' as unknown as number)).toThrow(TypeError)
  })
})

describe('lineTotal', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotal(2_500_000, 3)).toBe(7_500_000)
  })

  it('rejects zero and fractional quantities', () => {
    expect(() => lineTotal(2_500_000, 0)).toThrow(RangeError)
    expect(() => lineTotal(2_500_000, 1.5)).toThrow(RangeError)
  })
})

describe('sumMungu', () => {
  it('sums an empty cart to zero', () => {
    expect(sumMungu([])).toBe(0)
  })

  it('rejects a float sneaking into the list', () => {
    expect(() => sumMungu([100, 12.5])).toThrow(TypeError)
  })
})
