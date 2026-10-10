import { describe, expect, it } from 'vitest'
import {
  buildCallbackUrl,
  buildPathCallbackUrl,
  cleanPathToken,
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
      buildCallbackUrl(
        'https://shop.example.mn',
        '/api/qpay/callback',
        'UD-1001',
        SECRET,
      ),
    )
    expect(url.pathname).toBe('/api/qpay/callback')
    expect(url.searchParams.get('order')).toBe('UD-1001')
    expect(
      verifyCallbackToken('UD-1001', url.searchParams.get('t'), SECRET),
    ).toBe(true)
  })

  it('carries the path for another provider', () => {
    const url = new URL(
      buildCallbackUrl(
        'https://shop.example.mn',
        '/api/storepay/callback',
        'UD-1001',
        SECRET,
      ),
    )
    expect(url.pathname).toBe('/api/storepay/callback')
  })

  it('round-trips an order number containing URL-significant characters', () => {
    const url = new URL(
      buildCallbackUrl('https://x.mn', '/api/qpay/callback', 'UD/1001&x', SECRET),
    )
    expect(url.searchParams.get('order')).toBe('UD/1001&x')
  })
})

describe('buildPathCallbackUrl', () => {
  /** What the /api/storepay/callback/$orderNo/$token route receives. */
  function routeParams(href: string) {
    const [orderNo, token] = new URL(href).pathname
      .replace('/api/storepay/callback/', '')
      .split('/')
      .map(decodeURIComponent)
    return { orderNo, token }
  }

  const base = () =>
    buildPathCallbackUrl('https://shop.example.mn', '/api/storepay/callback', 'UD-260929-NTYD', SECRET)

  it('puts the order and a valid token in the path', () => {
    expect(base()).toBe(
      `https://shop.example.mn/api/storepay/callback/UD-260929-NTYD/${signCallbackToken('UD-260929-NTYD', SECRET)}`,
    )
    const { orderNo, token } = routeParams(base())
    expect(verifyCallbackToken(orderNo!, token, SECRET)).toBe(true)
  })

  // StorePay's guide shows it appending `?id=<loanId>` to the URL it is given.
  // Either way it does that, the token must still verify.
  it('survives StorePay appending ?id=', () => {
    const { orderNo, token } = routeParams(`${base()}?id=2248245`)
    expect(verifyCallbackToken(orderNo!, token, SECRET)).toBe(true)
  })

  it('survives StorePay appending &id= with no ?', () => {
    // Lands in the token's path segment; the route trims it off first.
    const { orderNo, token } = routeParams(`${base()}&id=2248245`)
    expect(verifyCallbackToken(orderNo!, cleanPathToken(token!), SECRET)).toBe(true)
  })

  it('still rejects a forged token after trimming', () => {
    const forged = signCallbackToken('UD-OTHER', SECRET)
    expect(verifyCallbackToken('UD-260929-NTYD', cleanPathToken(`${forged}&id=1`), SECRET)).toBe(false)
    expect(verifyCallbackToken('UD-260929-NTYD', cleanPathToken('&id=1'), SECRET)).toBe(false)
  })

  it('encodes an order number containing URL-significant characters', () => {
    const href = buildPathCallbackUrl('https://x.mn', '/api/storepay/callback/', 'UD/1 0', SECRET)
    expect(routeParams(href).orderNo).toBe('UD/1 0')
  })
})
