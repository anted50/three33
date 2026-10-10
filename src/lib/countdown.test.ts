import { describe, expect, it } from 'vitest'
import { formatCountdown } from './countdown'

describe('formatCountdown', () => {
  it('shows hours for a fresh two-hour invoice', () => {
    expect(formatCountdown((118 * 60 + 21) * 1000)).toBe('1:58:21')
  })

  it('drops the hour under sixty minutes', () => {
    expect(formatCountdown((4 * 60 + 7) * 1000)).toBe('4:07')
  })

  it('never goes negative after expiry', () => {
    expect(formatCountdown(-5000)).toBe('0:00')
  })
})
