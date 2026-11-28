import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '../cookies'
import { readSessionToken } from './cookie'

const withCookie = (header: string) => new Request('https://example.test/', { headers: { cookie: header } })

describe('readSessionToken', () => {
  it('finds the session cookie among others', () => {
    expect(readSessionToken(withCookie(`a=1; ${SESSION_COOKIE}=abc%2Fdef; b=2`))).toBe('abc/def')
  })

  it('reads a missing cookie or header as no session', () => {
    expect(readSessionToken(new Request('https://example.test/'))).toBeNull()
    expect(readSessionToken(withCookie('a=1; b'))).toBeNull()
  })

  it('reads a value that is not valid percent-encoding as no session, not a crash', () => {
    // Goal: decodeURIComponent throws URIError on "%E0%A4%A"; that must end
    // as a 401 from adminOnly, never a 500.
    expect(readSessionToken(withCookie(`${SESSION_COOKIE}=%E0%A4%A`))).toBeNull()
  })
})
