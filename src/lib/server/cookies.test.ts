import { describe, expect, it } from 'vitest'
import { clearCookie, parseCookies, serializeCookie } from './cookies'

describe('serializeCookie', () => {
  it('defaults to the attributes the session cookie must have', () => {
    const c = serializeCookie('uc_session', 'abc123')
    expect(c).toContain('uc_session=abc123')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/')
  })

  it('omits Secure outside production so localhost dev works over http', () => {
    // NODE_ENV is 'test' under Vitest.
    expect(serializeCookie('uc_session', 'abc')).not.toContain('Secure')
    expect(serializeCookie('uc_session', 'abc', { secure: true })).toContain(
      'Secure',
    )
  })

  it('encodes values that would otherwise break the header', () => {
    expect(serializeCookie('c', 'a;b=c')).toContain('c=a%3Bb%3Dc')
  })

  it('emits both Max-Age and Expires', () => {
    const c = serializeCookie('c', 'v', { maxAge: 60 })
    expect(c).toContain('Max-Age=60')
    expect(c).toMatch(/Expires=\w{3}, /)
  })
})

describe('parseCookies', () => {
  it('parses a normal header', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' })
  })

  it('returns empty for missing headers rather than throwing', () => {
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('round-trips an encoded value', () => {
    const header = serializeCookie('c', 'a;b=c').split(';')[0]!
    expect(parseCookies(header)).toEqual({ c: 'a;b=c' })
  })

  it('skips malformed pairs instead of failing the request', () => {
    expect(parseCookies('garbage; a=1; =2')).toEqual({ a: '1' })
  })
})

describe('clearCookie', () => {
  it('expires immediately', () => {
    expect(clearCookie('uc_session')).toContain('Max-Age=0')
  })
})
