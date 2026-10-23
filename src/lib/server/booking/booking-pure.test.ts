import { describe, expect, it } from 'vitest'
import { freeStarts } from './availability'
import { planSchedule } from './schedule-plan'
import { addDays, atLocal, datesBetween, isoWeekday, localDateOf } from './time'
import { apiErrorFromDb, findDbViolation, isUniqueViolation } from '../api/db-errors'

const t = (hhmm: string, date = '2026-09-29') => atLocal(date, hhmm)
const hhmm = (d: Date) =>
  new Date(d.getTime() + 8 * 3600e3).toISOString().slice(11, 16)

describe('time', () => {
  it('pins wall-clock times to UTC+8', () => {
    expect(t('09:00').toISOString()).toBe('2026-09-29T01:00:00.000Z')
    expect(t('24:00').toISOString()).toBe('2026-09-29T16:00:00.000Z')
  })

  it('reads the local day of an instant, across UTC midnight', () => {
    expect(localDateOf(new Date('2026-09-29T17:30:00Z'))).toBe('2026-09-30')
    expect(localDateOf(new Date('2026-09-29T15:59:00Z'))).toBe('2026-09-29')
  })

  it('walks days and weekdays', () => {
    expect(datesBetween('2026-09-30', '2026-10-02')).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(isoWeekday('2026-10-05')).toBe(1) // Monday
    expect(isoWeekday('2026-10-11')).toBe(7) // Sunday
  })
})

describe('planSchedule', () => {
  it('builds a week: Mon–Wed 9–15, Thu closed, Fri–Sun 16–22', () => {
    const plan = planSchedule([
      { from: '2026-10-05', to: '2026-10-07', start: '09:00', end: '15:00' },
      { from: '2026-10-08', to: '2026-10-08', closed: true },
      { from: '2026-10-09', to: '2026-10-11', start: '16:00', end: '22:00' },
    ])
    expect([...plan.keys()]).toHaveLength(7)
    expect(plan.get('2026-10-08')).toEqual({ kind: 'closed' })
    const fri = plan.get('2026-10-09')
    expect(fri?.kind).toBe('open')
    if (fri?.kind === 'open') {
      expect(hhmm(fri.windows[0]!.startsAt)).toBe('16:00')
      expect(hhmm(fri.windows[0]!.endsAt)).toBe('22:00')
    }
  })

  it('applies weekday filters inside a range', () => {
    const plan = planSchedule([{ from: '2026-10-05', to: '2026-10-18', weekdays: [1, 2, 3], start: '09:00', end: '15:00' }])
    expect([...plan.keys()]).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13', '2026-10-14'])
  })

  it('allows two windows in a day, refuses overlaps and open-and-closed', () => {
    const plan = planSchedule([
      { from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '12:00' },
      { from: '2026-10-05', to: '2026-10-05', start: '13:00', end: '18:00' },
    ])
    expect(plan.get('2026-10-05')).toMatchObject({ kind: 'open' })

    expect(() =>
      planSchedule([
        { from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '12:00' },
        { from: '2026-10-05', to: '2026-10-05', start: '11:00', end: '14:00' },
      ]),
    ).toThrow(/overlap/)

    expect(() =>
      planSchedule([
        { from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '12:00' },
        { from: '2026-10-05', to: '2026-10-05', closed: true },
      ]),
    ).toThrow(/both open and closed/)
  })

  it('takes any hours, including a late window ending at midnight', () => {
    const plan = planSchedule([{ from: '2026-10-05', to: '2026-10-05', start: '20:00', end: '24:00' }])
    const day = plan.get('2026-10-05')
    expect(day?.kind === 'open' && hhmm(day.windows[0]!.endsAt)).toBe('00:00')
  })

  it('refuses backwards windows and ranges', () => {
    expect(() => planSchedule([{ from: '2026-10-05', to: '2026-10-05', start: '15:00', end: '09:00' }])).toThrow(/end after/)
    expect(() => planSchedule([{ from: '2026-10-06', to: '2026-10-05', closed: true }])).toThrow(/before/)
  })
})

describe('freeStarts', () => {
  const windows = [{ startsAt: t('10:00'), endsAt: t('18:00') }]
  const busy = [
    { startsAt: t('11:00'), endsAt: t('12:15') },
    { startsAt: t('19:00'), endsAt: t('19:55') }, // moved outside the window by the admin
  ]

  it('offers only starts where the whole service fits', () => {
    const starts = freeStarts(windows, busy, 55, t('00:00')).map(hhmm)
    expect(starts[0]).toBe('10:00')
    expect(starts).not.toContain('10:15') // would run into 11:00
    expect(starts[1]).toBe('12:15') // right when the booking ends
    expect(starts.at(-1)).toBe('17:00') // 17:00 + 55 min fits before 18:00
  })

  it('skips the past', () => {
    const starts = freeStarts(windows, [], 30, t('16:05')).map(hhmm)
    expect(starts).toEqual(['16:15', '16:30', '16:45', '17:00', '17:15', '17:30'])
  })

  it('has nothing to offer without a window', () => {
    expect(freeStarts([], [], 30, t('00:00'))).toEqual([])
  })
})

describe('db errors', () => {
  // Messages as D1 reports them, wrapped the way Drizzle wraps them.
  const d1 = (message: string) => new Error('Failed query: insert ...', { cause: new Error(`D1_ERROR: ${message}: SQLITE_CONSTRAINT`) })

  it('maps the overlap triggers and known unique columns to stable codes', () => {
    expect(findDbViolation(d1('appointments_no_overlap'))).toEqual({ kind: 'trigger', target: 'appointments_no_overlap' })
    expect(apiErrorFromDb(d1('appointments_no_overlap'))).toMatchObject({ status: 409, code: 'TIME_TAKEN' })
    expect(apiErrorFromDb(d1('UNIQUE constraint failed: users.email'))).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' })
    expect(apiErrorFromDb(d1('availability_no_overlap'))).toMatchObject({ status: 409, code: 'WINDOW_OVERLAP' })
  })

  it('uses a batch guard code as the API error code', () => {
    expect(apiErrorFromDb(d1('guard:SALE_NOT_OPEN'))).toMatchObject({ status: 409, code: 'SALE_NOT_OPEN' })
  })

  it('falls back by kind, and ignores errors that are not violations', () => {
    expect(apiErrorFromDb(d1('UNIQUE constraint failed: carts.session_token'))).toMatchObject({ status: 409, code: 'CONFLICT' })
    expect(apiErrorFromDb(d1('CHECK constraint failed: users_role_check'))).toMatchObject({ status: 400, code: 'INVALID' })
    expect(apiErrorFromDb(d1('FOREIGN KEY constraint failed'))).toMatchObject({ status: 409, code: 'IN_USE' })
    expect(apiErrorFromDb(new Error('boom'))).toBeNull()
  })

  it('matches unique violations by exact column list', () => {
    expect(isUniqueViolation(d1('UNIQUE constraint failed: products.slug'), 'products.slug')).toBe(true)
    expect(isUniqueViolation(d1('UNIQUE constraint failed: products.slug'), 'categories.slug')).toBe(false)
  })
})
