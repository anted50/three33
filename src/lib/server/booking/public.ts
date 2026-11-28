import { and, gt, gte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointments, availability } from '~/db/schema'
import { assert } from '~/lib/assert'
import { isoDate } from '../api/input'
import { loadBookingFee } from '../settings'
import { freeStarts } from './availability'
import { bookableService, listServices } from './services'
import { addDays, atLocal, datesBetween, localDateOf } from './time'

/** Most days the public page may ask slots for at once. */
const SLOT_DAYS_MAX = 31

/** What the public booking page reads. */

/** Step 1: the services, and the fee that confirms a booking. */
export async function bookingOptions() {
  const [services, bookingFee] = await Promise.all([listServices({ activeOnly: true }), loadBookingFee()])
  return {
    /** Null = an admin hasn't set the fee yet; online booking is off. */
    bookingFee,
    services: services.map(({ id, name, description, durationMinutes, price }) => ({ id, name, description, durationMinutes, price })),
  }
}

export const slotsQuery = z.object({
  serviceId: z.uuid(),
  from: isoDate,
  days: z.coerce.number().int().min(1).max(SLOT_DAYS_MAX).default(14),
})

/**
 * Step 2: free start times for one service, day by day. A day the barber
 * hasn't opened has no slots — there is nothing else to say about it.
 */
export async function availableSlots(input: z.infer<typeof slotsQuery>) {
  assert(input.days >= 1, 'slotsQuery asks for at least one day')
  assert(input.days <= SLOT_DAYS_MAX, 'slotsQuery bounds the days')
  const service = await bookableService(input.serviceId)
  const to = addDays(input.from, input.days - 1)
  const start = atLocal(input.from, '00:00')
  const end = atLocal(addDays(to, 1), '00:00')
  const [windows, busy] = await Promise.all([readWindows(start, end), readBusy(start, end)])

  const now = new Date()
  const days = datesBetween(input.from, to, SLOT_DAYS_MAX).map((date) => {
    const open = windows.filter((window) => localDateOf(window.startsAt) === date)
    return { date, slots: freeStarts({ windows: open, busy, durationMinutes: service.durationMinutes, notBefore: now }) }
  })
  assert(days.length === input.days, 'one entry per day asked for')
  return {
    service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
    days,
  }
}

/**
 * The barber's windows starting in [start, end). No LIMIT: the range is at
 * most SLOT_DAYS_MAX days and the no-overlap trigger keeps windows apart.
 */
function readWindows(start: Date, end: Date) {
  return db
    .select({ startsAt: availability.startsAt, endsAt: availability.endsAt })
    .from(availability)
    .where(and(gte(availability.startsAt, start), lt(availability.startsAt, end)))
}

/**
 * Bookings and holds that overlap [start, end) at all — one starting the
 * evening before still blocks the morning. Never truncated: a missing busy
 * block would offer a taken time. Bounded like readWindows, by the range and
 * the no-overlap trigger.
 */
function readBusy(start: Date, end: Date) {
  return db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(and(ne(appointments.status, 'cancelled'), lt(appointments.startsAt, end), gt(appointments.endsAt, start)))
}
