import { badRequest } from '../api/errors'
import { atLocal, datesBetween, isoWeekday, type IsoDate } from './time'

/**
 * Turns a barber's schedule request into one plan per calendar day. Pure:
 * unit tested, no database.
 *
 * A request is a list of entries, each covering a date range and optionally
 * only some weekdays:
 *
 *   { from: '2026-10-05', to: '2026-10-07', start: '09:00', end: '15:00', locationId }
 *   { from: '2026-10-08', to: '2026-10-08', off: true }
 *   { from: '2026-10-09', to: '2026-10-11', start: '16:00', end: '22:00', locationId }
 *
 * Every day a request touches is REPLACED as a whole with what the request
 * says for it — so sending the same schedule twice changes nothing, and
 * changing one day never disturbs the days around it. Several shift entries
 * may land on one day (morning at A, afternoon at B); `off` and `clear`
 * must stand alone.
 *
 *   shifts  working, in these windows
 *   off     the barber has said they won't work
 *   clear   back to unknown: nothing said about this day
 */

export type ScheduleEntry =
  | { from: IsoDate; to: IsoDate; weekdays?: number[]; start: string; end: string; locationId: string }
  | { from: IsoDate; to: IsoDate; weekdays?: number[]; off: true; note?: string }
  | { from: IsoDate; to: IsoDate; weekdays?: number[]; clear: true }

export interface Shift {
  locationId: string
  startsAt: Date
  endsAt: Date
}

export type DayPlan =
  | { kind: 'shifts'; shifts: Shift[] }
  | { kind: 'off'; note: string | null }
  | { kind: 'clear' }

/** Longest span one request may touch: two months of planning at once. */
export const MAX_SCHEDULE_DAYS = 62

export function planSchedule(entries: ScheduleEntry[]): Map<IsoDate, DayPlan> {
  const plan = new Map<IsoDate, DayPlan>()

  for (const entry of entries) {
    if (entry.to < entry.from) throw badRequest(`"to" is before "from" (${entry.from})`)

    const days = datesBetween(entry.from, entry.to)
    if (days.length > MAX_SCHEDULE_DAYS) {
      throw badRequest(`A schedule entry may cover at most ${MAX_SCHEDULE_DAYS} days`)
    }

    for (const day of days) {
      if (entry.weekdays && !entry.weekdays.includes(isoWeekday(day))) continue
      merge(plan, day, toDayPlan(entry, day))
    }
  }

  for (const [day, dayPlan] of plan) {
    if (dayPlan.kind === 'shifts') assertNoOverlap(day, dayPlan.shifts)
  }
  return plan
}

function toDayPlan(entry: ScheduleEntry, day: IsoDate): DayPlan {
  if ('off' in entry) return { kind: 'off', note: entry.note ?? null }
  if ('clear' in entry) return { kind: 'clear' }

  const startsAt = atLocal(day, entry.start)
  const endsAt = atLocal(day, entry.end)
  if (endsAt <= startsAt) {
    throw badRequest(`Shift on ${day} must end after it starts (${entry.start}–${entry.end})`)
  }
  return { kind: 'shifts', shifts: [{ locationId: entry.locationId, startsAt, endsAt }] }
}

function merge(plan: Map<IsoDate, DayPlan>, day: IsoDate, next: DayPlan) {
  const current = plan.get(day)
  if (!current) return plan.set(day, next)

  if (current.kind === 'shifts' && next.kind === 'shifts') {
    current.shifts.push(...next.shifts)
    return
  }
  throw badRequest(`${day} is given more than one meaning (working, off or clear)`)
}

function assertNoOverlap(day: IsoDate, shifts: Shift[]) {
  const sorted = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.startsAt < sorted[i - 1]!.endsAt) {
      throw badRequest(`Shifts on ${day} overlap each other`)
    }
  }
}
