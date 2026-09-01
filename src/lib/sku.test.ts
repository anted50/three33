import { describe, expect, it } from 'vitest'
import { generateSku, uniqueSku } from './sku'

describe('generateSku', () => {
  it('takes initials and the numeric part of the size', () => {
    expect(generateSku('Deluxe Pomade', '30g')).toBe('UD-DP-30')
    expect(generateSku('Featherweight', '70g')).toBe('UD-FE-70')
  })

  it('keeps a non-numeric size as a word', () => {
    expect(generateSku('Deluxe Pomade', 'Black')).toBe('UD-DP-BLACK')
  })

  it('drops the size segment when there is no size', () => {
    expect(generateSku('Deluxe Pomade', '')).toBe('UD-DP')
  })

  it('has nothing to suggest without a name', () => {
    expect(generateSku('', '30g')).toBe('')
  })
})

describe('uniqueSku', () => {
  it('returns the plain suggestion when nothing collides', () => {
    expect(uniqueSku('Deluxe Pomade', '30g', ['UD-FE-70'])).toBe('UD-DP-30')
  })

  it('steps past a code already in use', () => {
    expect(uniqueSku('Deluxe Pomade', '30g', ['UD-DP-30'])).toBe('UD-DP-30-2')
    expect(
      uniqueSku('Deluxe Pomade', '30g', ['UD-DP-30', 'UD-DP-30-2']),
    ).toBe('UD-DP-30-3')
  })

  it('compares case- and space-insensitively', () => {
    expect(uniqueSku('Deluxe Pomade', '30g', ['  ud-dp-30 '])).toBe('UD-DP-30-2')
  })

  it('separates variants that differ by something other than size', () => {
    const first = uniqueSku('Deluxe Pomade', '', [])
    expect(first).toBe('UD-DP')
    expect(uniqueSku('Deluxe Pomade', '', [first])).toBe('UD-DP-2')
  })

  it('still has nothing to suggest without a name', () => {
    expect(uniqueSku('', '30g', ['UD-DP-30'])).toBe('')
  })
})
