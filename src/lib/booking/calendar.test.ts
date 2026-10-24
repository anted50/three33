import { describe, expect, it } from 'vitest'
import { addMonths, dayTitle, formatDuration, isEvening, monthGrid, monthTitle, slotTime, todayUb, weekdayShort } from './calendar'

describe('booking calendar', () => {
  it('reads a slot in Ulaanbaatar time, whatever the instant says', () => {
    expect(slotTime('2026-10-29T06:30:00.000Z')).toBe('14:30')
    expect(slotTime('2026-10-29T14:30:00+08:00')).toBe('14:30')
  })

  it('puts the moon on slots from 18:00', () => {
    expect(isEvening('2026-10-29T09:59:00Z')).toBe(false)
    expect(isEvening('2026-10-29T10:00:00Z')).toBe(true)
  })

  it('takes today from Ulaanbaatar, not UTC', () => {
    // 20:00 UTC on the 24th is already 04:00 on the 25th in UB.
    expect(todayUb(new Date('2026-10-24T20:00:00Z'))).toBe('2026-10-25')
  })

  it('names days and months in Mongolian', () => {
    expect(dayTitle('2026-10-29')).toBe('Пүрэв, 10-р сарын 29')
    expect(weekdayShort('2026-10-25')).toBe('Ня')
    expect(monthTitle('2026-10')).toBe('2026 оны 10-р сар')
  })

  it('says durations the way the barber does', () => {
    expect(formatDuration(45)).toBe('45 мин')
    expect(formatDuration(60)).toBe('1 цаг')
    expect(formatDuration(75)).toBe('1 цаг 15 мин')
  })

  it('pads a Monday-first month grid before the 1st', () => {
    // October 2026 starts on a Thursday: three empty cells.
    const grid = monthGrid('2026-10')
    expect(grid.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(grid.at(-1)).toBe('2026-10-31')
    expect(grid).toHaveLength(34)
  })

  it('steps months across a year end', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
  })
})
