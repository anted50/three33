import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from './dates'

describe('dates', () => {
  // 13:41 UTC is 21:41 in Ulaanbaatar (UTC+8), whatever the machine's zone.
  const at = new Date('2026-09-29T13:41:44Z')

  it('formats in Ulaanbaatar time', () => {
    expect(formatDateTime(at)).toBe('2026.09.29 21:41')
  })

  it('rolls the date over at UB midnight, not UTC midnight', () => {
    expect(formatDate(new Date('2026-09-29T17:00:00Z'))).toBe('2026.09.30')
  })

  it('uses 00, not 24, for midnight', () => {
    expect(formatDateTime(new Date('2026-09-29T16:05:00Z'))).toBe('2026.09.30 00:05')
  })
})
