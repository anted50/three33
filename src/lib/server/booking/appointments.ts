import { and, asc, eq, getTableColumns, gte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, changed } from '~/db/atomic'
import { appointments } from '~/db/schema'
import { conflict, notFound } from '../api/errors'
import { isoDate } from '../api/input'
import { sendConfirmation } from './emails/confirmation'
import { addDays, addMinutes, atLocal } from './time'

/**
 * Bookings, as admins see and manage them. Every admin sees every booking.
 * A booking can be moved to another time or cancelled — by an admin only;
 * customers contact the shop to ask for either.
 */

export const appointmentsQuery = z.object({
  from: isoDate,
  to: isoDate,
  status: z.enum(['pending', 'booked', 'cancelled']).optional(),
})

export const rescheduleInput = z.object({ startsAt: z.iso.datetime({ offset: true }) })

/** Everything but the status-page token hash, which never leaves the server. */
const { accessTokenHash: _hidden, invoicePayload: _invoice, ...visible } = getTableColumns(appointments)

export async function listAppointments(query: z.infer<typeof appointmentsQuery>) {
  return db
    .select(visible)
    .from(appointments)
    .where(
      and(
        gte(appointments.startsAt, atLocal(query.from, '00:00')),
        lt(appointments.startsAt, atLocal(addDays(query.to, 1), '00:00')),
        // Unpaid holds aren't bookings yet; ask for them by status.
        query.status ? eq(appointments.status, query.status) : ne(appointments.status, 'pending'),
      ),
    )
    .orderBy(asc(appointments.startsAt))
}

export async function getAppointment(id: string) {
  const [row] = await db.select(visible).from(appointments).where(eq(appointments.id, id)).limit(1)
  if (!row) throw notFound('Booking')
  return row
}

/**
 * Moves a booking to another time — any time; the admin is not held to the
 * schedule. The length stays as booked. Overlap with another booking is
 * refused by the database (TIME_TAKEN).
 */
export async function reschedule(id: string, input: z.infer<typeof rescheduleInput>) {
  const row = await getAppointment(id)
  if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Booking is ${row.status}`)
  const startsAt = new Date(input.startsAt)
  await atomic([
    // Conditional on still being booked: a cancel in between wins.
    db
      .update(appointments)
      .set({ startsAt, endsAt: addMinutes(startsAt, row.durationMinutes) })
      .where(and(eq(appointments.id, id), eq(appointments.status, 'booked'))),
    changed('NOT_BOOKED'),
  ])
  return getAppointment(id)
}

/** Cancels a booking. The time becomes free for others at once. */
export async function cancel(id: string) {
  const row = await getAppointment(id)
  if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Booking is ${row.status}`)
  await atomic([
    db
      .update(appointments)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(and(eq(appointments.id, id), eq(appointments.status, 'booked'))),
    changed('NOT_BOOKED'),
  ])
  return getAppointment(id)
}

/** Sends the confirmation email again — after a reschedule, or if it went missing. */
export async function resendConfirmation(id: string) {
  const row = await getAppointment(id)
  if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Booking is ${row.status}`)
  return { outcome: await sendConfirmation(id, { force: true }) }
}
