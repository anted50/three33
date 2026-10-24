import { describe, expect, it } from 'vitest'
import { bookingIcs } from './ics'

describe('bookingIcs', () => {
  const ics = bookingIcs(
    { bookingNo: 'BK-261029-7QF4', service: 'Үс засалт', startsAt: '2026-10-29T06:30:00.000Z', endsAt: '2026-10-29T07:15:00.000Z' },
    new Date('2026-10-24T10:00:00Z'),
  )

  it('writes the times in UTC', () => {
    expect(ics).toContain('DTSTART:20261029T063000Z')
    expect(ics).toContain('DTEND:20261029T071500Z')
  })

  it('escapes the commas in the address', () => {
    expect(ics).toContain('LOCATION:UB Central Residence\\, 1 давхар\\, Сүхбаатар дүүрэг\\, 3-р хороо')
  })

  it('uses CRLF line endings, as the format requires', () => {
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR')
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })
})
