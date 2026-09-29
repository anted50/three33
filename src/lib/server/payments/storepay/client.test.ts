import { describe, expect, it } from 'vitest'
import { resolveExpiry } from './client'

describe('resolveExpiry', () => {
  const now = 1_700_000_000_000 // epoch ms

  it('treats expires_in as a duration in seconds, minus the safety margin', () => {
    expect(resolveExpiry(7200, now)).toBe(now + 7_200_000 - 60_000)
  })

  it('never returns a time in the past for a tiny duration', () => {
    expect(resolveExpiry(5, now)).toBeGreaterThan(now)
  })

  it('never returns a time in the past for a zero duration', () => {
    expect(resolveExpiry(0, now)).toBe(now + 30_000)
  })
})
