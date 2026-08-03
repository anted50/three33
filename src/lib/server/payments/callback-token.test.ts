import { describe, expect, it } from 'vitest'
import {
  buildCallbackUrl,
  signCallbackToken,
  verifyCallbackToken,
} from './callback-token'

const SECRET = 'test-secret-that-is-long-enough-to-be-realistic'

describe('signCallbackToken', () => {
  it('is deterministic for the same order', () => {
    expect(signCallbackToken('UD-1001', SECRET)).toBe(
      signCallbackToken('UD-1001', SECRET),
    )
  })

  it('differs per order', () => {
    expect(signCallbackToken('UD-1001', SECRET)).not.toBe(
      signCallbackToken('UD-1002', SECRET),
    )
  })

  it('differs per secret, so a rotated key invalidates old URLs', () => {
    expect(signCallbackToken('UD-1001', SECRET)).not.toBe(
      signCallbackToken('UD-1001', 'a-different-secret'),
    )
  })

  it('refuses to sign with an empty secret', () => {
    expect(() => signCallbackToken('UD-1001', '')).toThrow()
  })
})

describe('verifyCallbackToken', () => {
  it('accepts a token it produced', () => {
    const token = signCallbackToken('UD-1001', SECRET)
    expect(verifyCallbackToken('UD-1001', token, SECRET)).toBe(true)
  })

  it('rejects a token minted for a different order', () => {
    // The attack: replay a valid callback URL against someone else's order.
    const token = signCallbackToken('UD-1002', SECRET)
    expect(verifyCallbackToken('UD-1001', token, SECRET)).toBe(false)
  })

  it('rejects missing, empty and truncated tokens', () => {
    const token = signCallbackToken('UD-1001', SECRET)
    expect(verifyCallbackToken('UD-1001', null, SECRET)).toBe(false)
    expect(verifyCallbackToken('UD-1001', '', SECRET)).toBe(false)
    expect(verifyCallbackToken('UD-1001', token.slice(0, -1), SECRET)).toBe(
      false,
    )
  })

  it('rejects a token signed with the wrong secret', () => {
    const token = signCallbackToken('UD-1001', 'a-different-secret')
    expect(verifyCallbackToken('UD-1001', token, SECRET)).toBe(false)
  })
})

describe('buildCallbackUrl', () => {
  it('produces an absolute URL carrying order and token', () => {
    const url = new URL(
      buildCallbackUrl('https://shop.example.mn', 'UD-1001', SECRET),
    )
    expect(url.pathname).toBe('/api/qpay/callback')
    expect(url.searchParams.get('order')).toBe('UD-1001')
    expect(
      verifyCallbackToken('UD-1001', url.searchParams.get('t'), SECRET),
    ).toBe(true)
  })

  it('round-trips an order number containing URL-significant characters', () => {
    const url = new URL(buildCallbackUrl('https://x.mn', 'UD/1001&x', SECRET))
    expect(url.searchParams.get('order')).toBe('UD/1001&x')
  })
})
