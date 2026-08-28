import { describe, expect, it } from 'vitest'
import {
  decodeCheckoutCookie,
  encodeCheckoutCookie,
  hashOrderToken,
  mintOrderToken,
  verifyOrderToken,
} from './access'

describe('order access tokens', () => {
  it('accepts the token it minted', () => {
    const { token, hash } = mintOrderToken()
    expect(verifyOrderToken(token, hash)).toBe(true)
  })

  it('stores only the hash', () => {
    const { token, hash } = mintOrderToken()
    expect(hash).not.toContain(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mints a different token each time', () => {
    expect(mintOrderToken().token).not.toBe(mintOrderToken().token)
  })

  it('rejects another order’s token', () => {
    const mine = mintOrderToken()
    const theirs = mintOrderToken()
    expect(verifyOrderToken(theirs.token, mine.hash)).toBe(false)
  })

  it('rejects a missing token or hash', () => {
    const { token, hash } = mintOrderToken()
    expect(verifyOrderToken(null, hash)).toBe(false)
    expect(verifyOrderToken(undefined, hash)).toBe(false)
    expect(verifyOrderToken('', hash)).toBe(false)
    expect(verifyOrderToken(token, null)).toBe(false)
    expect(verifyOrderToken(token, '')).toBe(false)
  })

  it('rejects a hash of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch; the guard has to come first.
    const { token } = mintOrderToken()
    expect(() => verifyOrderToken(token, 'abc')).not.toThrow()
    expect(verifyOrderToken(token, 'abc')).toBe(false)
  })

  it('hashes deterministically', () => {
    expect(hashOrderToken('same-input')).toBe(hashOrderToken('same-input'))
    expect(hashOrderToken('a')).not.toBe(hashOrderToken('b'))
  })
})

describe('checkout cookie', () => {
  it('round-trips', () => {
    const { token } = mintOrderToken()
    const decoded = decodeCheckoutCookie(
      encodeCheckoutCookie('UD-260828-7QF4', token),
    )
    expect(decoded).toEqual({ orderNo: 'UD-260828-7QF4', token })
  })

  it('splits on the first colon only', () => {
    const decoded = decodeCheckoutCookie('UD-260828-7QF4:aa:bb')
    expect(decoded).toEqual({ orderNo: 'UD-260828-7QF4', token: 'aa:bb' })
  })

  it('rejects malformed values', () => {
    expect(decodeCheckoutCookie(null)).toBeNull()
    expect(decodeCheckoutCookie('')).toBeNull()
    expect(decodeCheckoutCookie('no-separator')).toBeNull()
    expect(decodeCheckoutCookie(':orphan-token')).toBeNull()
    expect(decodeCheckoutCookie('orphan-order:')).toBeNull()
  })
})
