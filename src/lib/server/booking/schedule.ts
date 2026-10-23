import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic } from '~/db/atomic'
import { appointments, availability } from '~/db/schema'
import { badRequest, notFound } from '../api/errors'
import { clockTime, isoDate } from '../api/input'
import { localDay } from './db'
import { planSchedule, type ScheduleEntry } from './schedule-plan'
import { addDays, atLocal, datesBetween, type IsoDate } from './time'

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
    .max(50),
})

export const scheduleQuery = z.object({ from: isoDate, to: isoDate })

export async function applySchedule(input: z.infer<typeof scheduleInput>) {
  const plan = planSchedule(input.entries as ScheduleEntry[])
  const days = [...plan.keys()].sort()
  if (days.length === 0) throw badRequest('No days matched (check weekdays)')

  const windows = [...plan.values()].flatMap((p) => (p.kind === 'open' ? p.windows : []))

  // Each touched day is replaced as a whole, in one batch: never half old,
  // half new.
  await atomic([
    db.delete(availability).where(inArray(localDay(availability.startsAt), days)),
    windows.length > 0 && db.insert(availability).values(windows),
  ])

  return getSchedule(days[0]!, days.at(-1)!)
}

/** Removes one window. */
export async function deleteWindow(windowId: string) {
  const removed = await db.delete(availability).where(eq(availability.id, windowId)).returning({ id: availability.id })
  if (removed.length === 0) throw notFound('Window')
}

/** Each day from `from` to `to`, with its windows and its bookings. */
export async function getSchedule(from: IsoDate, to: IsoDate) {
  if (to < from) throw badRequest('"to" is before "from"')
  const days = datesBetween(from, to)
  if (days.length > 93) throw badRequest('At most 93 days at a time')

  const start = atLocal(from, '00:00')
  const end = atLocal(addDays(to, 1), '00:00')
  const windows = await db
    .select({ id: availability.id, startsAt: availability.startsAt, endsAt: availability.endsAt })
    .from(availability)
    .where(and(gte(availability.startsAt, start), lt(availability.startsAt, end)))
    .orderBy(asc(availability.startsAt))
  const booked = await db
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

  return days.map((date) => {
    const dayStart = atLocal(date, '00:00')
    const dayEnd = atLocal(addDays(date, 1), '00:00')
    const inDay = <T extends { startsAt: Date }>(rows: T[]) => rows.filter((r) => r.startsAt >= dayStart && r.startsAt < dayEnd)
    return { date, windows: inDay(windows), appointments: inDay(booked) }
  })
}
