import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentEvents, appointments, barberSales } from '~/db/schema'
import { conflict, notFound } from '../../api/errors'
import type { Staff } from '../../api/staff'
import type { Tx } from '../db'
import { addMinutes } from '../time'
import { getAppointment } from './queries'

/**
 * The barber changing a booking. Only the barber can: customers call them.
 * Every change is recorded in appointment_events with who did it.
 */

export const rescheduleInput = z.object({ startsAt: z.iso.datetime({ offset: true }) })
export const reasonInput = z.object({ reason: z.string().trim().max(500).optional() })

async function lockBooked(tx: Tx, barberId: string, id: string) {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.barberId, barberId)))
    .for('update')
    .limit(1)
  if (!row) throw notFound('Appointment')
  if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Appointment is ${row.status}`)
  return row
}

/**
 * Moves the same row to a new time — any time, shifts or not. Length and
 * buffer stay as booked, so the booking fee carries over untouched. Clears
 * the emergency flag. Overlap with another booking is refused by the database.
 */
export async function reschedule(staff: Staff, barberId: string, id: string, input: z.infer<typeof rescheduleInput>) {
  await db.transaction(async (tx) => {
    const row = await lockBooked(tx, barberId, id)
    const startsAt = new Date(input.startsAt)
    const endsAt = addMinutes(startsAt, (row.endsAt.getTime() - row.startsAt.getTime()) / 60_000)
    await tx
      .update(appointments)
      .set({ startsAt, endsAt, blockedUntil: addMinutes(endsAt, row.bufferMinutes), needsRescheduleAt: null })
      .where(eq(appointments.id, id))
    await tx.insert(appointmentEvents).values({
      appointmentId: id,
      kind: 'rescheduled',
      fromStartsAt: row.startsAt,
      toStartsAt: startsAt,
      actorId: staff.userId,
    })
  })
  return getAppointment(barberId, id)
}

/** Confirms a cancellation. Any booking fee is kept — no refunds. Refused
 * while a checkout for it is still open; void that first. */
export async function cancel(staff: Staff, barberId: string, id: string, input: z.infer<typeof reasonInput>) {
  await db.transaction(async (tx) => {
    await lockBooked(tx, barberId, id)
    const [openSale] = await tx
      .select({ id: barberSales.id })
      .from(barberSales)
      .where(and(eq(barberSales.appointmentId, id), ne(barberSales.status, 'void')))
      .limit(1)
    if (openSale) throw conflict('CHECKOUT_OPEN', 'Void the open checkout first')
    await tx.update(appointments).set({ status: 'cancelled' }).where(eq(appointments.id, id))
    await tx.insert(appointmentEvents).values({ appointmentId: id, kind: 'cancelled', actorId: staff.userId, note: input.reason ?? null })
  })
  return getAppointment(barberId, id)
}

/** The customer never came. Only after the start time; the fee is kept. */
export async function markNoShow(staff: Staff, barberId: string, id: string, input: z.infer<typeof reasonInput>) {
  await db.transaction(async (tx) => {
    const row = await lockBooked(tx, barberId, id)
    if (row.startsAt > new Date()) throw conflict('NOT_STARTED', 'The appointment has not started yet')
    await tx.update(appointments).set({ status: 'no_show' }).where(eq(appointments.id, id))
    await tx.insert(appointmentEvents).values({ appointmentId: id, kind: 'no_show', actorId: staff.userId, note: input.reason ?? null })
  })
  return getAppointment(barberId, id)
}
