import { assert } from '~/lib/assert'
import { D1_BOUND_PARAMETERS_MAX } from '~/db/limits'
import { badRequest } from '../api/errors'
import { atLocal, dayCount, datesBetween, isoWeekday, type IsoDate } from './time'

/**
 * Turns the barber's schedule request into one plan per calendar day. Pure:
 * unit tested, no database.
 *
 * A request is a list of entries, each covering a date range and optionally
 * only some weekdays:
 *
 *   { from: '2026-10-05', to: '2026-10-31', weekdays: [1,2,3,4,5], start: '10:00', end: '18:00' }
 *   { from: '2026-10-11', to: '2026-10-11', start: '12:00', end: '14:00' }
 *   { from: '2026-10-15', to: '2026-10-15', closed: true }
 *
 * Every day a request touches is REPLACED as a whole with what the request
 * says for it — so sending the same schedule twice changes nothing, and
 * changing one day never disturbs the days around it. Several windows may
 * land on one day (morning and evening); `closed` must stand alone and
 * empties the day. A day with no windows simply can't be booked.
 */

export type ScheduleEntry =
  | { from: IsoDate; to: IsoDate; weekdays?: number[]; start: string; end: string }
  | { from: IsoDate; to: IsoDate; weekdays?: number[]; closed: true }

export interface PlannedWindow {
  startsAt: Date
  endsAt: Date
}

export type DayPlan = { kind: 'open'; windows: PlannedWindow[] } | { kind: 'closed' }

/**
 * Most days one request may span, from its first day to its last, across all
 * its entries: about three months of planning at once. The span, not just the
 * count of touched days, is bounded because applySchedule answers with the
 * schedule from the first touched day to the last (one getSchedule call,
 * which allows the same many days). It also bounds the day list applySchedule
 * deletes by, which is one bound parameter per day.
 */
export const MAX_SCHEDULE_DAYS = 93
assert(MAX_SCHEDULE_DAYS < D1_BOUND_PARAMETERS_MAX, 'the schedule day list must fit one D1 statement')

/** Entries per request; the zod schema in schedule.ts allows the same. */
export const MAX_SCHEDULE_ENTRIES = 50

export function planSchedule(entries: ScheduleEntry[]): Map<IsoDate, DayPlan> {
  assert(entries.length <= MAX_SCHEDULE_ENTRIES, 'the schedule input bounds its entries')
  const plan = new Map<IsoDate, DayPlan>()

  for (const entry of entries) {
    checkEntryRange(entry)
    for (const day of datesBetween(entry.from, entry.to, MAX_SCHEDULE_DAYS)) {
      const included = !entry.weekdays || entry.weekdays.includes(isoWeekday(day))
      if (included) merge(plan, day, toDayPlan(entry, day))
    }
    // Checked per entry, so a request spread over years stops early.
    checkPlanSpan(plan)
  }

  for (const [day, dayPlan] of plan) {
    if (dayPlan.kind === 'open') assertNoOverlap(day, dayPlan.windows)
  }
  assert(plan.size <= MAX_SCHEDULE_DAYS, 'a bounded span holds at most that many days')
  return plan
}

function checkEntryRange(entry: ScheduleEntry): void {
  if (entry.to < entry.from) throw badRequest(`"to" is before "from" (${entry.from})`)
  if (dayCount(entry.from, entry.to) > MAX_SCHEDULE_DAYS) {
    throw badRequest(`A schedule entry may cover at most ${MAX_SCHEDULE_DAYS} days`)
  }
}

/** Two one-day entries a year apart touch two days but span a year. */
function checkPlanSpan(plan: Map<IsoDate, DayPlan>): void {
  if (plan.size === 0) return
  const days = [...plan.keys()].sort()
  if (dayCount(days[0]!, days.at(-1)!) > MAX_SCHEDULE_DAYS) {
    throw badRequest(`One schedule change may span at most ${MAX_SCHEDULE_DAYS} days, first to last`)
  }
}

function toDayPlan(entry: ScheduleEntry, day: IsoDate): DayPlan {
  if ('closed' in entry) return { kind: 'closed' }

  const startsAt = atLocal(day, entry.start)
  const endsAt = atLocal(day, entry.end)
  if (endsAt <= startsAt) {
    throw badRequest(`The window on ${day} must end after it starts (${entry.start}–${entry.end})`)
  }
  return { kind: 'open', windows: [{ startsAt, endsAt }] }
}

function merge(plan: Map<IsoDate, DayPlan>, day: IsoDate, next: DayPlan): void {
  const current = plan.get(day)
  if (!current) {
    plan.set(day, next)
  } else if (current.kind === 'open' && next.kind === 'open') {
    current.windows.push(...next.windows)
  } else {
    throw badRequest(`${day} is both open and closed in this request`)
  }
}

function assertNoOverlap(day: IsoDate, windows: PlannedWindow[]) {
  assert(windows.length > 0, 'an open day has at least one window')
  const sorted = [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index]!.startsAt < sorted[index - 1]!.endsAt) {
      throw badRequest(`Windows on ${day} overlap each other`)
    }
  }
}
