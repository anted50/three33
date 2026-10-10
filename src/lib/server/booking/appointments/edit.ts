import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentEvents, appointmentServices, appointments, barberSales, services } from '~/db/schema'
import { badRequest, conflict, notFound } from '../../api/errors'
import { email, phone } from '../../api/input'
import type { Staff } from '../../api/staff'
import { addMinutes } from '../time'
import { getAppointment } from './queries'

/**
 * Changing a booked appointment before checkout: its services (customer
 * wants a beard trim too), note, or customer contact details. New services
 * recompute the total and the end time; the start stays and the buffer stays
 * as booked. A longer booking that would run into the next one is refused
 * by the database (TIME_TAKEN). The total can't drop below a booking fee
 * already paid.
 */
export const editInput = z
  .object({
    serviceIds: z.array(z.uuid()).min(1).max(10),
    note: z.string().trim().max(500).nullable(),
    customerName: z.string().trim().min(1).max(120),
    customerPhone: phone,
    customerEmail: email.nullable(),
  })
  .partial()

export async function editAppointment(staff: Staff, barberId: string, id: string, input: z.infer<typeof editInput>) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.barberId, barberId)))
      .for('update')
      .limit(1)
    if (!row) throw notFound('Appointment')
    if (row.status !== 'booked') throw conflict('NOT_BOOKED', `Appointment is ${row.status}`)
    const [openSale] = await tx
      .select({ id: barberSales.id })
      .from(barberSales)
      .where(and(eq(barberSales.appointmentId, id), ne(barberSales.status, 'void')))
      .limit(1)
    if (openSale) throw conflict('CHECKOUT_OPEN', 'Change the lines on the open checkout instead')

    const { serviceIds, ...contact } = input
    const patch: Partial<typeof appointments.$inferInsert> = { ...contact }

    if (serviceIds) {
      const picked = await tx
        .select()
        .from(services)
        .where(and(inArray(services.id, serviceIds), eq(services.barberId, barberId), eq(services.locationId, row.locationId), eq(services.isActive, true)))
      if (picked.length !== new Set(serviceIds).size) throw badRequest('Unknown or inactive service for this location')
      const ordered = serviceIds.map((sid) => picked.find((s) => s.id === sid)!)

      const total = ordered.reduce((sum, s) => sum + s.price, 0)
      if (total < row.bookingFee) throw badRequest('The total cannot be less than the booking fee already paid')
      const endsAt = addMinutes(row.startsAt, ordered.reduce((sum, s) => sum + s.durationMinutes, 0))
      Object.assign(patch, { total, endsAt, blockedUntil: addMinutes(endsAt, row.bufferMinutes) })

      await tx.delete(appointmentServices).where(eq(appointmentServices.appointmentId, id))
      await tx.insert(appointmentServices).values(
        ordered.map((s, i) => ({
          appointmentId: id,
          serviceId: s.id,
          nameSnapshot: s.nameEn,
          priceSnapshot: s.price,
          durationMinutesSnapshot: s.durationMinutes,
          sortOrder: i,
        })),
      )
    }

    if (Object.keys(patch).length > 0) await tx.update(appointments).set(patch).where(eq(appointments.id, id))
    await tx.insert(appointmentEvents).values({ appointmentId: id, kind: 'updated', actorId: staff.userId })
  })
  return getAppointment(barberId, id)
}
