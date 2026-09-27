import { describe, expect, it } from 'vitest'
import { dayStatus, freeStarts } from './availability'
import { allocate, splitPayment } from './ledger-split'
import { planSchedule } from './schedule-plan'
import { addDays, atLocal, datesBetween, isoWeekday, localDateOf } from './time'
import { findPgViolation, apiErrorFromDb } from '../api/db-errors'

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
  const A = '11111111-1111-4111-8111-111111111111'

  it('builds the example week: Mon–Wed 9–15, Thu off, Fri–Sun 16–22', () => {
    const plan = planSchedule([
      { from: '2026-10-05', to: '2026-10-07', start: '09:00', end: '15:00', locationId: A },
      { from: '2026-10-08', to: '2026-10-08', off: true },
      { from: '2026-10-09', to: '2026-10-11', start: '16:00', end: '22:00', locationId: A },
    ])
    expect([...plan.keys()]).toHaveLength(7)
    expect(plan.get('2026-10-08')).toEqual({ kind: 'off', note: null })
    const fri = plan.get('2026-10-09')
    expect(fri?.kind).toBe('shifts')
    if (fri?.kind === 'shifts') {
      expect(hhmm(fri.shifts[0]!.startsAt)).toBe('16:00')
      expect(hhmm(fri.shifts[0]!.endsAt)).toBe('22:00')
    }
  })

  it('applies weekdays filters inside a range', () => {
    const plan = planSchedule([
      { from: '2026-10-05', to: '2026-10-18', weekdays: [1, 2, 3], start: '09:00', end: '15:00', locationId: A },
    ])
    expect([...plan.keys()]).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13', '2026-10-14',
    ])
  })

  it('allows two shifts in a day, refuses overlaps and mixed meanings', () => {
    const B = '22222222-2222-4222-8222-222222222222'
    const plan = planSchedule([
      { from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '12:00', locationId: A },
      { from: '2026-10-05', to: '2026-10-05', start: '13:00', end: '18:00', locationId: B },
    ])
    expect(plan.get('2026-10-05')).toMatchObject({ kind: 'shifts' })

    expect(() =>
      planSchedule([
        { from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '12:00', locationId: A },
        { from: '2026-10-05', to: '2026-10-05', start: '11:00', end: '14:00', locationId: B },
      ]),
    ).toThrow(/overlap/)

    expect(() =>
      planSchedule([
        { from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '12:00', locationId: A },
        { from: '2026-10-05', to: '2026-10-05', off: true },
      ]),
    ).toThrow(/more than one meaning/)
  })

  it('refuses backwards shifts and ranges', () => {
    expect(() =>
      planSchedule([{ from: '2026-10-05', to: '2026-10-05', start: '15:00', end: '09:00', locationId: A }]),
    ).toThrow(/end after/)
    expect(() => planSchedule([{ from: '2026-10-06', to: '2026-10-05', clear: true }])).toThrow(/before/)
  })
})

describe('freeStarts', () => {
  const shifts = [{ startsAt: t('10:00'), endsAt: t('18:00') }]
  const busy = [
    { startsAt: t('11:00'), blockedUntil: t('12:15') },
    { startsAt: t('19:00'), blockedUntil: t('19:55') }, // overtime, outside the shift
  ]

  it('offers only starts where the whole block fits', () => {
    const starts = freeStarts(shifts, busy, 55, t('00:00')).map(hhmm)
    expect(starts[0]).toBe('10:00')
    expect(starts).not.toContain('10:15') // would run into 11:00
    expect(starts[1]).toBe('12:15') // right when the buffer ends
    expect(starts.at(-1)).toBe('17:00') // 17:00 + 55 min fits before 18:00
  })

  it('skips the past', () => {
    const starts = freeStarts(shifts, [], 30, t('16:05')).map(hhmm)
    expect(starts).toEqual(['16:15', '16:30', '16:45', '17:00', '17:15', '17:30'])
  })
})

describe('dayStatus', () => {
  it('tells working, elsewhere, off and unknown apart', () => {
    expect(dayStatus({ shiftsHere: 1, shiftsElsewhere: 0, isOff: false })).toBe('working')
    expect(dayStatus({ shiftsHere: 0, shiftsElsewhere: 2, isOff: false })).toBe('elsewhere')
    expect(dayStatus({ shiftsHere: 0, shiftsElsewhere: 0, isOff: true })).toBe('off')
    expect(dayStatus({ shiftsHere: 0, shiftsElsewhere: 0, isOff: false })).toBe('unknown')
  })
})

describe('splitPayment', () => {
  const rates = { serviceCutBps: 3000, productCommissionBps: 1000 }
  const svc = (n: number) => ({ service: n, product: 0 })

  it('matches the worked example: 30% cut on services', () => {
    expect(splitPayment('qpay', svc(1_000_000), rates)).toEqual([
      { kind: 'service_share', grossAmount: 1_000_000, rateBps: 3000, amount: 700_000 },
    ])
    expect(splitPayment('cash', svc(4_000_000), rates)).toEqual([
      { kind: 'service_share', grossAmount: 4_000_000, rateBps: 3000, amount: 2_800_000 },
      { kind: 'cash_collected', grossAmount: 4_000_000, rateBps: null, amount: -4_000_000 },
    ])
  })

  it('gives commission on products, and owes back all cash', () => {
    expect(splitPayment('cash', { service: 0, product: 6_000_000 }, rates)).toEqual([
      { kind: 'product_commission', grossAmount: 6_000_000, rateBps: 1000, amount: 600_000 },
      { kind: 'cash_collected', grossAmount: 6_000_000, rateBps: null, amount: -6_000_000 },
    ])
    expect(splitPayment('pos', { service: 0, product: 6_000_000 }, { ...rates, productCommissionBps: 0 })).toEqual([])
  })

  it('rounds the way of the barber', () => {
    expect(splitPayment('pos', svc(333), rates)[0]!.amount).toBe(234) // cut 99.9 -> 99
    expect(splitPayment('pos', { service: 0, product: 333 }, rates)[0]!.amount).toBe(34) // 33.3 -> 34
  })
})

describe('allocate', () => {
  it('covers products first, then services, exactly', () => {
    // 60,000 pomade + 50,000 haircut, paid 30,000 then 80,000
    expect(allocate(3_000_000, 6_000_000, 0)).toEqual({ product: 3_000_000, service: 0 })
    expect(allocate(8_000_000, 6_000_000, 3_000_000)).toEqual({ product: 3_000_000, service: 5_000_000 })
    expect(allocate(1_000_000, 0, 0)).toEqual({ product: 0, service: 1_000_000 })
  })
})

describe('db errors', () => {
  it('finds a violation wrapped by drizzle, for either driver', () => {
    const pglite = { cause: { code: '23P01', constraint: 'appointments_no_overlap' } }
    const postgres = { cause: { code: '23505', constraint_name: 'users_email_key' } }
    expect(findPgViolation(pglite)).toEqual({ sqlstate: '23P01', constraint: 'appointments_no_overlap' })
    expect(apiErrorFromDb(pglite)).toMatchObject({ status: 409, code: 'TIME_TAKEN' })
    expect(apiErrorFromDb(postgres)).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' })
    expect(apiErrorFromDb(new Error('boom'))).toBeNull()
  })
})
