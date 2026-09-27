import { and, asc, desc, eq, getTableColumns, gte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointments, barberSales, barbers, locations } from '~/db/schema'
import { notFound } from '../api/errors'
import { isoDate } from '../api/input'
import { getSale } from './sales/queries'
import { addDays, atLocal } from './time'

/**
 * The owner's view across every barber and location — the barber API only
 * ever shows a barber their own. Read-only; the owner acts on bookings
 * through their own barber profile.
 */

export const ownerAppointmentsQuery = z.object({
  from: isoDate,
  to: isoDate,
  barberId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: z.enum(['pending', 'booked', 'completed', 'cancelled', 'no_show']).optional(),
})

const { accessTokenHash: _hidden, ...visible } = getTableColumns(appointments)

export async function listAllAppointments(q: z.infer<typeof ownerAppointmentsQuery>) {
  const conditions = [
    gte(appointments.startsAt, atLocal(q.from, '00:00')),
    lt(appointments.startsAt, atLocal(addDays(q.to, 1), '00:00')),
    q.status ? eq(appointments.status, q.status) : ne(appointments.status, 'pending'),
  ]
  if (q.barberId) conditions.push(eq(appointments.barberId, q.barberId))
  if (q.locationId) conditions.push(eq(appointments.locationId, q.locationId))
  return db
    .select({ ...visible, barberName: barbers.name, locationName: locations.nameEn })
    .from(appointments)
    .innerJoin(barbers, eq(barbers.id, appointments.barberId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(and(...conditions))
    .orderBy(asc(appointments.startsAt))
    .limit(500)
}

export const ownerSalesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  barberId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: z.enum(['open', 'paid', 'void']).optional(),
})

export async function listAllSales(q: z.infer<typeof ownerSalesQuery>) {
  const conditions = []
  if (q.from) conditions.push(gte(barberSales.createdAt, atLocal(q.from, '00:00')))
  if (q.to) conditions.push(lt(barberSales.createdAt, atLocal(addDays(q.to, 1), '00:00')))
  if (q.barberId) conditions.push(eq(barberSales.barberId, q.barberId))
  if (q.locationId) conditions.push(eq(barberSales.locationId, q.locationId))
  if (q.status) conditions.push(eq(barberSales.status, q.status))
  return db
    .select({ ...getTableColumns(barberSales), barberName: barbers.name, locationName: locations.nameEn })
    .from(barberSales)
    .innerJoin(barbers, eq(barbers.id, barberSales.barberId))
    .innerJoin(locations, eq(locations.id, barberSales.locationId))
    .where(and(...conditions))
    .orderBy(desc(barberSales.createdAt))
    .limit(500)
}

export async function getAnySale(saleId: string) {
  const [row] = await db.select({ barberId: barberSales.barberId }).from(barberSales).where(eq(barberSales.id, saleId)).limit(1)
  if (!row) throw notFound('Sale')
  return getSale(row.barberId, saleId)
}
