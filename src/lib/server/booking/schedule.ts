import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barberDaysOff, barberShifts } from '~/db/schema'
import { badRequest } from '../api/errors'
import { clockTime, isoDate } from '../api/input'
import { assertWorksAt } from './barber-locations'
import { localDay } from './db'
import { planSchedule, type ScheduleEntry } from './schedule-plan'
import { addDays, atLocal, datesBetween, type IsoDate } from './time'

/**
 * The barber's schedule: which days they work (and where, when), which days
 * they are off, and — by saying nothing — which days are still unknown.
 * See schedule-plan.ts for how a request becomes per-day plans.
 *
 * Appointments never reference shifts, so rewriting a day never cancels or
 * moves a booking; one that ends up outside the new shifts simply becomes
 * overtime.
 */

const range = { from: isoDate, to: isoDate, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional() }

export const scheduleInput = z.object({
  entries: z
    .array(
      z.union([
        z.object({ ...range, start: clockTime, end: clockTime, locationId: z.uuid() }),
        z.object({ ...range, off: z.literal(true), note: z.string().trim().max(200).optional() }),
        z.object({ ...range, clear: z.literal(true) }),
      ]),
    )
    .min(1)
    .max(50),
})

export async function applySchedule(barberId: string, input: z.infer<typeof scheduleInput>) {
  const plan = planSchedule(input.entries as ScheduleEntry[])
  const days = [...plan.keys()].sort()
  if (days.length === 0) throw badRequest('No days matched (check weekdays)')

  const shiftLocations = [...plan.values()].flatMap((p) => (p.kind === 'shifts' ? p.shifts.map((s) => s.locationId) : []))
  await assertWorksAt(barberId, shiftLocations)

  await db.transaction(async (tx) => {
    await tx
      .delete(barberShifts)
      .where(and(eq(barberShifts.barberId, barberId), inArray(localDay(barberShifts.startsAt), days)))
    await tx.delete(barberDaysOff).where(and(eq(barberDaysOff.barberId, barberId), inArray(barberDaysOff.day, days)))

    const shifts = [...plan.values()].flatMap((p) => (p.kind === 'shifts' ? p.shifts : []))
    if (shifts.length > 0) {
      await tx.insert(barberShifts).values(shifts.map((s) => ({ ...s, barberId })))
    }
    const off = [...plan.entries()].flatMap(([day, p]) => (p.kind === 'off' ? [{ barberId, day, note: p.note }] : []))
    if (off.length > 0) await tx.insert(barberDaysOff).values(off)
  })

  return getSchedule(barberId, days[0]!, days.at(-1)!)
}

export async function getSchedule(barberId: string, from: IsoDate, to: IsoDate) {
  if (to < from) throw badRequest('"to" is before "from"')
  const days = datesBetween(from, to)
  if (days.length > 93) throw badRequest('At most 93 days at a time')

  const shifts = await db
    .select({ id: barberShifts.id, locationId: barberShifts.locationId, startsAt: barberShifts.startsAt, endsAt: barberShifts.endsAt })
    .from(barberShifts)
    .where(
      and(
        eq(barberShifts.barberId, barberId),
        gte(barberShifts.startsAt, atLocal(from, '00:00')),
        lt(barberShifts.startsAt, atLocal(addDays(to, 1), '00:00')),
      ),
    )
    .orderBy(asc(barberShifts.startsAt))
  const off = await db
    .select({ day: barberDaysOff.day, note: barberDaysOff.note })
    .from(barberDaysOff)
    .where(and(eq(barberDaysOff.barberId, barberId), gte(barberDaysOff.day, from), lt(barberDaysOff.day, addDays(to, 1))))

  const offByDay = new Map(off.map((o) => [o.day, o.note]))
  return days.map((date) => {
    const dayShifts = shifts.filter((s) => s.startsAt >= atLocal(date, '00:00') && s.startsAt < atLocal(addDays(date, 1), '00:00'))
    const status = dayShifts.length > 0 ? 'working' : offByDay.has(date) ? 'off' : 'unknown'
    return { date, status, note: offByDay.get(date) ?? null, shifts: dayShifts }
  })
}
