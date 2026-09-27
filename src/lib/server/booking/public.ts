import { and, asc, eq, gt, gte, inArray, lt, ne } from 'drizzle-orm'
import { db } from '~/db'
import { appointments, barberDaysOff, barberLocations, barberShifts, barbers, services } from '~/db/schema'
import { badRequest, notFound } from '../api/errors'
import { dayStatus, freeStarts } from './availability'
import { addDays, atLocal, datesBetween, type IsoDate } from './time'

/**
 * What the public booking pages read. Only active locations, barbers and
 * services; only fields a customer should see.
 */

export async function barbersAtLocation(locationId: string) {
  const rows = await db
    .select({
      id: barbers.id,
      slug: barbers.slug,
      name: barbers.name,
      phone: barbers.phone,
      photoUrl: barbers.photoUrl,
      bioMn: barbers.bioMn,
      bioEn: barbers.bioEn,
      bookingFee: barbers.bookingFee,
    })
    .from(barbers)
    .innerJoin(barberLocations, eq(barberLocations.barberId, barbers.id))
    .where(and(eq(barberLocations.locationId, locationId), eq(barbers.isActive, true)))
    .orderBy(asc(barbers.sortOrder), asc(barbers.name))

  const offered = await activeServices(locationId, rows.map((r) => r.id))
  return rows
    .map((b) => ({
      ...b,
      /** A barber without a fee can't be booked online: show "call to book". */
      onlineBooking: b.bookingFee > 0,
      services: offered.filter((s) => s.barberId === b.id).map(({ barberId: _, ...s }) => s),
    }))
    .filter((b) => b.services.length > 0)
}

async function activeServices(locationId: string, barberIds: string[]) {
  if (barberIds.length === 0) return []
  return db
    .select({
      id: services.id,
      barberId: services.barberId,
      nameEn: services.nameEn,
      nameMn: services.nameMn,
      descriptionEn: services.descriptionEn,
      descriptionMn: services.descriptionMn,
      price: services.price,
      durationMinutes: services.durationMinutes,
    })
    .from(services)
    .where(and(eq(services.locationId, locationId), eq(services.isActive, true), inArray(services.barberId, barberIds)))
    .orderBy(asc(services.sortOrder), asc(services.nameEn))
}

/**
 * Day-by-day availability of one barber at one location. Every day gets a
 * status — working / elsewhere / off / unknown — so customers are never shown
 * an empty day as "fully booked" when the barber simply hasn't planned it.
 * Slots are only computed when services are given, since their total
 * duration (plus the barber's buffer) decides what fits.
 */
export async function availability(input: {
  barberId: string
  locationId: string
  from: IsoDate
  days: number
  serviceIds: string[]
}) {
  const [barber] = await db
    .select({ id: barbers.id, name: barbers.name, bufferMinutes: barbers.bufferMinutes, bookingFee: barbers.bookingFee })
    .from(barbers)
    .innerJoin(barberLocations, eq(barberLocations.barberId, barbers.id))
    .where(and(eq(barbers.id, input.barberId), eq(barbers.isActive, true), eq(barberLocations.locationId, input.locationId)))
    .limit(1)
  if (!barber) throw notFound('Barber at this location')

  const blockMinutes = await blockFor(input, barber.bufferMinutes)
  const to = addDays(input.from, input.days - 1)
  const windowStart = atLocal(input.from, '00:00')
  const windowEnd = atLocal(addDays(to, 1), '00:00')

  const shifts = await db
    .select({ locationId: barberShifts.locationId, startsAt: barberShifts.startsAt, endsAt: barberShifts.endsAt })
    .from(barberShifts)
    .where(and(eq(barberShifts.barberId, barber.id), gte(barberShifts.startsAt, windowStart), lt(barberShifts.startsAt, windowEnd)))
  const busy = await db
    .select({ startsAt: appointments.startsAt, blockedUntil: appointments.blockedUntil })
    .from(appointments)
    .where(
      and(
        eq(appointments.barberId, barber.id),
        ne(appointments.status, 'cancelled'),
        lt(appointments.startsAt, windowEnd),
        gt(appointments.blockedUntil, windowStart),
      ),
    )
  const offDays = new Set(
    (
      await db
        .select({ day: barberDaysOff.day })
        .from(barberDaysOff)
        .where(and(eq(barberDaysOff.barberId, barber.id), gte(barberDaysOff.day, input.from), lt(barberDaysOff.day, addDays(to, 1))))
    ).map((d) => d.day),
  )

  const now = new Date()
  const days = datesBetween(input.from, to).map((date) => {
    const inDay = shifts.filter((s) => s.startsAt >= atLocal(date, '00:00') && s.startsAt < atLocal(addDays(date, 1), '00:00'))
    const here = inDay.filter((s) => s.locationId === input.locationId)
    const status = dayStatus({ shiftsHere: here.length, shiftsElsewhere: inDay.length - here.length, isOff: offDays.has(date) })
    return {
      date,
      status,
      shifts: here.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
      slots: blockMinutes && status === 'working' ? freeStarts(here, busy, blockMinutes, now) : [],
    }
  })

  return {
    barber: { id: barber.id, name: barber.name, onlineBooking: barber.bookingFee > 0 },
    locationId: input.locationId,
    blockMinutes,
    days,
  }
}

async function blockFor(input: { barberId: string; locationId: string; serviceIds: string[] }, buffer: number) {
  if (input.serviceIds.length === 0) return null
  const rows = await db
    .select({ durationMinutes: services.durationMinutes })
    .from(services)
    .where(
      and(
        inArray(services.id, input.serviceIds),
        eq(services.barberId, input.barberId),
        eq(services.locationId, input.locationId),
        eq(services.isActive, true),
      ),
    )
  if (rows.length !== new Set(input.serviceIds).size) {
    throw badRequest('Unknown service for this barber at this location')
  }
  return rows.reduce((sum, r) => sum + r.durationMinutes, 0) + buffer
}
