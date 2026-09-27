import { and, asc, desc, eq, gte, lt, ne } from 'drizzle-orm'
import { getTableColumns } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentEvents, appointmentPayments, appointmentServices, appointments, barberSales } from '~/db/schema'
import { notFound } from '../../api/errors'
import { isoDate } from '../../api/input'
import type { Executor } from '../db'
import { addDays, atLocal } from '../time'

/** Reading a barber's appointments. Every query is scoped to the barber. */

export const appointmentsQuery = z.object({
  from: isoDate,
  to: isoDate,
  status: z.enum(['pending', 'booked', 'completed', 'cancelled', 'no_show']).optional(),
  /** Only the emergency call list. */
  needsReschedule: z.enum(['true']).optional(),
})

/** Everything but the status-page token hash, which never leaves the server. */
const { accessTokenHash: _hidden, ...visible } = getTableColumns(appointments)

export async function listAppointments(barberId: string, query: z.infer<typeof appointmentsQuery>) {
  const conditions = [
    eq(appointments.barberId, barberId),
    gte(appointments.startsAt, atLocal(query.from, '00:00')),
    lt(appointments.startsAt, atLocal(addDays(query.to, 1), '00:00')),
  ]
  if (query.status) conditions.push(eq(appointments.status, query.status))
  else conditions.push(ne(appointments.status, 'pending')) // unpaid holds aren't bookings
  const rows = await db.select(visible).from(appointments).where(and(...conditions)).orderBy(asc(appointments.startsAt))
  const filtered = query.needsReschedule ? rows.filter((r) => r.needsRescheduleAt) : rows
  return Promise.all(filtered.map(async (a) => ({ ...a, services: await linesOf(a.id) })))
}

export async function getAppointment(barberId: string, id: string, ex: Executor = db) {
  const [appointment] = await ex
    .select(visible)
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.barberId, barberId)))
    .limit(1)
  if (!appointment) throw notFound('Appointment')

  const events = await ex.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, id)).orderBy(asc(appointmentEvents.createdAt))
  const feePayments = await ex
    .select({ id: appointmentPayments.id, amount: appointmentPayments.amount, status: appointmentPayments.status, paidAt: appointmentPayments.paidAt })
    .from(appointmentPayments)
    .where(eq(appointmentPayments.appointmentId, id))
  const [checkout] = await ex
    .select({ id: barberSales.id, saleNo: barberSales.saleNo, status: barberSales.status })
    .from(barberSales)
    .where(and(eq(barberSales.appointmentId, id), ne(barberSales.status, 'void')))
    .orderBy(desc(barberSales.createdAt))
    .limit(1)

  return { ...appointment, services: await linesOf(id, ex), events, feePayments, checkout: checkout ?? null }
}

function linesOf(appointmentId: string, ex: Executor = db) {
  return ex
    .select({
      serviceId: appointmentServices.serviceId,
      name: appointmentServices.nameSnapshot,
      price: appointmentServices.priceSnapshot,
      durationMinutes: appointmentServices.durationMinutesSnapshot,
    })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appointmentId))
    .orderBy(asc(appointmentServices.sortOrder))
}
