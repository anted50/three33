import { and, gt, gte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointments, availability } from '~/db/schema'
import { isoDate } from '../api/input'
import { loadBookingFee } from '../settings'
import { freeStarts } from './availability'
import { bookableService, listServices } from './services'
import { addDays, atLocal, datesBetween } from './time'

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
  days: z.coerce.number().int().min(1).max(31).default(14),
})

/**
 * Step 2: free start times for one service, day by day. A day the barber
 * hasn't opened has no slots — there is nothing else to say about it.
 */
export async function availableSlots(input: z.infer<typeof slotsQuery>) {
  const service = await bookableService(input.serviceId)
  const to = addDays(input.from, input.days - 1)
  const start = atLocal(input.from, '00:00')
  const end = atLocal(addDays(to, 1), '00:00')

  const windows = await db
    .select({ startsAt: availability.startsAt, endsAt: availability.endsAt })
    .from(availability)
    .where(and(gte(availability.startsAt, start), lt(availability.startsAt, end)))
  const busy = await db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(and(ne(appointments.status, 'cancelled'), lt(appointments.startsAt, end), gt(appointments.endsAt, start)))

  const now = new Date()
  return {
    service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
    days: datesBetween(input.from, to).map((date) => {
      const dayStart = atLocal(date, '00:00')
      const dayEnd = atLocal(addDays(date, 1), '00:00')
      const open = windows.filter((w) => w.startsAt >= dayStart && w.startsAt < dayEnd)
      return { date, slots: freeStarts(open, busy, service.durationMinutes, now) }
    }),
  }
}
