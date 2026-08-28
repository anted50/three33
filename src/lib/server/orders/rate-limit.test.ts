import { describe, expect, it } from 'vitest'
import { decideRateLimit, DEFAULT_LIMITS } from './rate-limit'

describe('decideRateLimit', () => {
  it('allows an ordinary checkout', () => {
    expect(decideRateLimit({ byIp: 0, byPhone: 0 })).toEqual({ allowed: true })
  })

  it('allows a customer retrying a few times', () => {
    // Fixing a typo in an address should never hit a limit.
    expect(decideRateLimit({ byIp: 3, byPhone: 2 })).toEqual({ allowed: true })
  })

  it('refuses at the phone limit, not one past it', () => {
    expect(
      decideRateLimit({ byIp: 0, byPhone: DEFAULT_LIMITS.perPhone }),
    ).toEqual({ allowed: false, reason: 'phone' })
  })

  it('refuses at the ip limit', () => {
    expect(decideRateLimit({ byIp: DEFAULT_LIMITS.perIp, byPhone: 0 })).toEqual({
      allowed: false,
      reason: 'ip',
    })
  })

  it('still applies the phone limit when the ip is unknown', () => {
    // Behind a proxy that strips the address, the phone limit is all there is.
    expect(
      decideRateLimit({ byIp: null, byPhone: DEFAULT_LIMITS.perPhone }),
    ).toEqual({ allowed: false, reason: 'phone' })
  })

  it('allows an unknown ip that is under the phone limit', () => {
    expect(decideRateLimit({ byIp: null, byPhone: 0 })).toEqual({
      allowed: true,
    })
  })

  it('reports the phone first when both are over', () => {
    expect(decideRateLimit({ byIp: 99, byPhone: 99 })).toEqual({
      allowed: false,
      reason: 'phone',
    })
  })

  it('honours custom limits', () => {
    expect(
      decideRateLimit({ byIp: 1, byPhone: 1 }, { perIp: 1, perPhone: 5 }),
    ).toEqual({ allowed: false, reason: 'ip' })
  })
})
