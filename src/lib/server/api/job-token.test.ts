import { describe, expect, it } from 'vitest'
import { verifyJobToken } from './job-token'

const TOKEN = 'a'.repeat(40)

describe('verifyJobToken', () => {
  it('accepts the configured token as a bearer header', () => {
    expect(verifyJobToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
  })

  it('is case-insensitive about the scheme only', () => {
    expect(verifyJobToken(`bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(verifyJobToken(`Bearer ${TOKEN.toUpperCase()}`, TOKEN)).toBe(false)
  })

  it('rejects a wrong token, including one of a different length', () => {
    expect(verifyJobToken(`Bearer ${'b'.repeat(40)}`, TOKEN)).toBe(false)
    expect(verifyJobToken(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(verifyJobToken('Bearer short', TOKEN)).toBe(false)
  })

  it('rejects a missing or malformed header', () => {
    expect(verifyJobToken(null, TOKEN)).toBe(false)
    expect(verifyJobToken(undefined, TOKEN)).toBe(false)
    expect(verifyJobToken('', TOKEN)).toBe(false)
    expect(verifyJobToken(TOKEN, TOKEN)).toBe(false)
    expect(verifyJobToken(`Basic ${TOKEN}`, TOKEN)).toBe(false)
    expect(verifyJobToken('Bearer ', TOKEN)).toBe(false)
  })

  it('never matches when no token is configured', () => {
    expect(verifyJobToken('Bearer ', '')).toBe(false)
    expect(verifyJobToken('Bearer x', '')).toBe(false)
  })
})
