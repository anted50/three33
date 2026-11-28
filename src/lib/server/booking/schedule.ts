import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, insertRows } from '~/db/atomic'
import { appointments, availability } from '~/db/schema'
import { badRequest, notFound } from '../api/errors'
import { clockTime, isoDate } from '../api/input'
import { localDay } from './db'
import { assert } from '~/lib/assert'
import { MAX_SCHEDULE_DAYS, MAX_SCHEDULE_ENTRIES, planSchedule, type ScheduleEntry } from './schedule-plan'
import { addDays, atLocal, dayCount, datesBetween, localDateOf, type IsoDate } from './time'

/**
 * The barber's schedule: the windows he is open for bookings. He sets it
 * however he likes — any day, any hours, several windows a day — from admin.
 * See schedule-plan.ts for how a request becomes per-day plans.
 *
 * Appointments never reference windows, so rewriting a day never cancels or
 * moves a booking; one that ends up outside the new windows still stands.
 */

const range = { from: isoDate, to: isoDate, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional() }

export const scheduleInput = z.object({
  entries: z
    .array(z.union([z.object({ ...range, start: clockTime, end: clockTime }), z.object({ ...range, closed: z.literal(true) })]))
    .min(1)
    .max(MAX_SCHEDULE_ENTRIES),
})

export const scheduleQuery = z.object({ from: isoDate, to: isoDate })

export async function applySchedule(input: z.infer<typeof scheduleInput>) {
  const plan = planSchedule(input.entries satisfies ScheduleEntry[])
  const days = [...plan.keys()].sort()
  if (days.length === 0) throw badRequest('No days matched (check weekdays)')
  assert(days.length <= MAX_SCHEDULE_DAYS, 'planSchedule bounds the days a request touches')

  const windows = [...plan.values()].flatMap((dayPlan) => (dayPlan.kind === 'open' ? dayPlan.windows : []))

  // Each touched day is replaced as a whole, in one batch: never half old,
  // half new. insertRows splits a long schedule under D1's parameter limit.
  await atomic([
    db.delete(availability).where(inArray(localDay(availability.startsAt), days)),
    ...(windows.length > 0 ? insertRows(availability, windows) : []),
  ])

  // planSchedule bounds the span first to last, so this read cannot refuse a
  // change that was just written.
  return getSchedule(days[0]!, days.at(-1)!)
}

/** Removes one window. */
export async function deleteWindow(windowId: string) {
  const removed = await db.delete(availability).where(eq(availability.id, windowId)).returning({ id: availability.id })
  if (removed.length === 0) throw notFound('Window')
  assert(removed.length === 1, 'a window id matches one row')
}

/**
 * Each day from `from` to `to`, with its windows and its bookings.
 *
 * Neither read needs a LIMIT of its own: the range is at most
 * MAX_SCHEDULE_DAYS, and the no-overlap triggers keep both windows and
 * non-cancelled bookings from piling up inside it.
 */
export async function getSchedule(from: IsoDate, to: IsoDate) {
  if (to < from) throw badRequest('"to" is before "from"')
  if (dayCount(from, to) > MAX_SCHEDULE_DAYS) throw badRequest(`At most ${MAX_SCHEDULE_DAYS} days at a time`)
  const days = datesBetween(from, to, MAX_SCHEDULE_DAYS)

  const start = atLocal(from, '00:00')
  const end = atLocal(addDays(to, 1), '00:00')
  const [windows, booked] = await Promise.all([readWindows(start, end), readBookings(start, end)])

  return days.map((date) => ({
    date,
    windows: windows.filter((window) => localDateOf(window.startsAt) === date),
    appointments: booked.filter((appointment) => localDateOf(appointment.startsAt) === date),
  }))
}

/** Windows starting in [start, end), earliest first. */
function readWindows(start: Date, end: Date) {
  assert(start < end, 'readWindows: the range must not be empty')
  return db
    .select({ id: availability.id, startsAt: availability.startsAt, endsAt: availability.endsAt })
    .from(availability)
    .where(and(gte(availability.startsAt, start), lt(availability.startsAt, end)))
    .orderBy(asc(availability.startsAt))
}

/** Bookings and holds starting in [start, end), earliest first. */
function readBookings(start: Date, end: Date) {
  assert(start < end, 'readBookings: the range must not be empty')
  return db
    .select({
      id: appointments.id,
      bookingNo: appointments.bookingNo,
      status: appointments.status,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      serviceName: appointments.serviceName,
      customerName: appointments.customerName,
    })
    .from(appointments)
    .where(and(ne(appointments.status, 'cancelled'), gte(appointments.startsAt, start), lt(appointments.startsAt, end)))
    .orderBy(asc(appointments.startsAt))
}
