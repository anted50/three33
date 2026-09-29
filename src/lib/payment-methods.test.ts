import { describe, expect, it } from 'vitest'
import { tugrikToMungu } from './money'
import { meetsMinimum } from './payment-methods'

describe('meetsMinimum', () => {
  it('rejects StorePay below 100,000₮', () => {
    expect(meetsMinimum('storepay', tugrikToMungu(99_999))).toBe(false)
  })

  it('accepts StorePay at exactly 100,000₮', () => {
    expect(meetsMinimum('storepay', tugrikToMungu(100_000))).toBe(true)
  })

  it('compares mungu, not raw tugrik', () => {
    // 100,000 mungu is 1,000₮ — well under the minimum.
    expect(meetsMinimum('storepay', 100_000)).toBe(false)
  })

  it('places no floor on QPay', () => {
    expect(meetsMinimum('qpay', tugrikToMungu(100))).toBe(true)
  })
})
