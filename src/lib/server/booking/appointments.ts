import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, getTableColumns, gte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, changed } from '~/db/atomic'
import { appointments } from '~/db/schema'
import { assert } from '~/lib/assert'
import { badRequest, conflict, notFound } from '../api/errors'
import { email, isoDate, phone } from '../api/input'
import { inBackground } from '../background'
import { sendCancelled, sendRescheduled } from './emails/changes'
import { sendConfirmation } from './emails/confirmation'
import { generateBookingNo } from './refs'
import { bookableService } from './services'
import { MAX_SCHEDULE_DAYS } from './schedule-plan'
import { addDays, addMinutes, atLocal, dayCount } from './time'

/**
 * Bookings, as admins see and manage them. Every admin sees every booking.
 * A booking can be moved to another time or cancelled — by an admin only;
 * customers contact the shop to ask for either, and are emailed when it is
 * done. An admin can also enter a booking himself (a phone call, a walk-in).
 */

export const appointmentsQuery = z.object({
  from: isoDate,
  to: isoDate,
  status: z.enum(['pending', 'booked', 'cancelled']).optional(),
})

export const rescheduleInput = z.object({ startsAt: z.iso.datetime({ offset: true }) })

export const adminBookingInput = z.object({
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: phone,
  /** Optional: a phone booking may not give one. With it, a confirmation goes out. */
  customerEmail: email.nullish(),
  note: z.string().trim().max(500).nullish(),
})

/** Everything but the status-page token hash, which never leaves the server. */
const { accessTokenHash: _hidden, invoicePayload: _invoice, ...visible } = getTableColumns(appointments)

/**
 * Most rows one list returns. Cancelled bookings are not kept apart by the
 * no-overlap trigger, so the date range alone does not bound the list; a
 * range holding more than this is refused rather than cut short.
 */
const APPOINTMENTS_LIST_MAX = 5_000

/** The admin list covers a range, never the whole table: same bound as the schedule view. */
export async function listAppointments(query: z.infer<typeof appointmentsQuery>) {
  if (query.to < query.from) throw badRequest('"to" is before "from"')
  if (dayCount(query.from, query.to) > MAX_SCHEDULE_DAYS) throw badRequest(`At most ${MAX_SCHEDULE_DAYS} days at a time`)
  const rows = await db
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
    .limit(APPOINTMENTS_LIST_MAX + 1)
  if (rows.length > APPOINTMENTS_LIST_MAX) throw badRequest(`More than ${APPOINTMENTS_LIST_MAX} bookings; ask for fewer days`)
  return rows
}

export async function getAppointment(id: string) {
  const [row] = await db.select(visible).from(appointments).where(eq(appointments.id, id)).limit(1)
  if (!row) throw notFound('Booking')
  return row
}

/**
 * A booking the admin enters himself. Booked at once, with no fee and no
 * hold; at any time — like a reschedule, the admin is not held to the
 * schedule. The only thing refused is overlapping another booking
 * (TIME_TAKEN). With an email, the confirmation goes out.
 */
export async function createAdminBooking(input: z.infer<typeof adminBookingInput>) {
  const service = await bookableService(input.serviceId)
  const startsAt = new Date(input.startsAt)
  const endsAt = addMinutes(startsAt, service.durationMinutes)
  assert(endsAt > startsAt, 'a service has a positive length')
  const id = crypto.randomUUID()
  await atomic([
    db.insert(appointments).values({
      id,
      bookingNo: generateBookingNo(),
      source: 'admin',
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      status: 'booked',
      startsAt,
      endsAt,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail ?? null,
      note: input.note ?? null,
      bookingFee: 0,
      // No customer link is handed out; the hash still guards a future one.
      accessTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    }),
  ])
  if (input.customerEmail) inBackground(`booking confirmation ${id}`, sendConfirmation(id))
  return getAppointment(id)
}

/**
 * Moves a booking to another time — any time; the admin is not held to the
 * schedule. The length stays as booked. Overlap with another booking is
 * refused by the database (TIME_TAKEN). The customer is emailed the new time.
 */
export async function reschedule(id: string, input: z.infer<typeof rescheduleInput>) {
  const row = await getAppointment(id)
  if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Booking is ${row.status}`)
  const startsAt = new Date(input.startsAt)
  const endsAt = addMinutes(startsAt, row.durationMinutes)
  assert(endsAt > startsAt, 'a booking has a positive length')
  await atomic([
    // Conditional on still being booked: a cancel in between wins.
    db
      .update(appointments)
      .set({ startsAt, endsAt })
      .where(and(eq(appointments.id, id), eq(appointments.status, 'booked'))),
    changed('NOT_BOOKED'),
  ])
  inBackground(`reschedule email ${id}`, sendRescheduled(id, { startsAt: row.startsAt }))
  return getAppointment(id)
}

/**
 * Cancels a booking. The time becomes free for others at once, and the
 * customer is emailed. The booking fee is kept — it is non-refundable.
 */
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
  inBackground(`cancellation email ${id}`, sendCancelled(id))
  return getAppointment(id)
}

/** Sends the confirmation email again — if the customer says it never arrived. */
export async function resendConfirmation(id: string) {
  const row = await getAppointment(id)
  if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Booking is ${row.status}`)
  return { outcome: await sendConfirmation(id, { force: true }) }
}
