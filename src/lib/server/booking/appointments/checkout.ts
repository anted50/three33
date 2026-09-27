import { and, eq, ne, sum } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentPayments, appointmentServices, appointments, barberSales } from '~/db/schema'
import { conflict, notFound } from '../../api/errors'
import type { Staff } from '../../api/staff'
import { insertSale, saleLineInput } from '../sales/create'
import { getSale } from '../sales/queries'

/**
 * "The service is finished — take the money." Opens a POS sale linked to the
 * appointment. Lines default to what was booked, but the barber may change
 * them (added a beard trim, charged a friend less). The booking fee already
 * paid online is the sale's credit, so the customer only pays the rest.
 *
 * Payments then go through the sales API; when they cover the sale, the
 * appointment is completed in the same transaction (sales/finalize.ts).
 * Calling this again returns the checkout already open.
 */
export const checkoutInput = z.object({
  lines: z.array(saleLineInput).min(1).max(30).optional(),
  note: z.string().trim().max(500).nullish(),
})

export async function startCheckout(staff: Staff, barberId: string, id: string, input: z.infer<typeof checkoutInput>) {
  const saleId = await db.transaction(async (tx) => {
    const [appointment] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.barberId, barberId)))
      .for('update')
      .limit(1)
    if (!appointment) throw notFound('Appointment')

    const [open] = await tx
      .select({ id: barberSales.id })
      .from(barberSales)
      .where(and(eq(barberSales.appointmentId, id), ne(barberSales.status, 'void')))
      .limit(1)
    if (open) return open.id
    if (appointment.status !== 'booked') throw conflict('NOT_BOOKED', `Appointment is ${appointment.status}`)

    const lines =
      input.lines ??
      (
        await tx
          .select({ serviceId: appointmentServices.serviceId, name: appointmentServices.nameSnapshot, unitAmount: appointmentServices.priceSnapshot })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, id))
          .orderBy(appointmentServices.sortOrder)
      ).map((l) => ({ ...l, qty: 1, description: null }))

    const [{ feePaid }] = (await tx
      .select({ feePaid: sum(appointmentPayments.amount).mapWith(Number) })
      .from(appointmentPayments)
      .where(and(eq(appointmentPayments.appointmentId, id), eq(appointmentPayments.kind, 'booking_fee'), eq(appointmentPayments.status, 'paid')))) as [
      { feePaid: number | null },
    ]

    return insertSale(
      tx,
      staff,
      barberId,
      {
        locationId: appointment.locationId,
        lines,
        note: input.note ?? null,
        customerName: appointment.customerName,
        customerPhone: appointment.customerPhone,
        customerEmail: appointment.customerEmail,
      },
      { appointmentId: id, credit: feePaid ?? 0 },
    )
  })
  return getSale(barberId, saleId)
}
