import { and, eq, ne, sum } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, exists, guard } from '~/db/atomic'
import { appointmentPayments, appointmentServices, appointments, barberSales } from '~/db/schema'
import { isUniqueViolation } from '../../api/db-errors'
import { conflict, notFound } from '../../api/errors'
import type { Staff } from '../../api/staff'
import { prepareSale, saleLineInput } from '../sales/create'
import { getSale } from '../sales/queries'

/**
 * "The service is finished — take the money." Opens a POS sale linked to the
 * appointment. Lines default to what was booked, but the barber may change
 * them (added a beard trim, charged a friend less). The booking fee already
 * paid online is the sale's credit, so the customer only pays the rest.
 *
 * Payments then go through the sales API; when they cover the sale, the
 * appointment is completed in the same batch (sales/finalize.ts).
 * Calling this again returns the checkout already open.
 */
export const checkoutInput = z.object({
  lines: z.array(saleLineInput).min(1).max(30).optional(),
  note: z.string().trim().max(500).nullish(),
})

export async function startCheckout(staff: Staff, barberId: string, id: string, input: z.infer<typeof checkoutInput>) {
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.barberId, barberId)))
    .limit(1)
  if (!appointment) throw notFound('Appointment')

  const open = await openCheckout(id)
  if (open) return getSale(barberId, open)
  if (appointment.status !== 'booked') throw conflict('NOT_BOOKED', `Appointment is ${appointment.status}`)

  const lines =
    input.lines ??
    (
      await db
        .select({ serviceId: appointmentServices.serviceId, name: appointmentServices.nameSnapshot, unitAmount: appointmentServices.priceSnapshot })
        .from(appointmentServices)
        .where(eq(appointmentServices.appointmentId, id))
        .orderBy(appointmentServices.sortOrder)
    ).map((l) => ({ ...l, qty: 1, description: null }))

  const [{ feePaid }] = (await db
    .select({ feePaid: sum(appointmentPayments.amount).mapWith(Number) })
    .from(appointmentPayments)
    .where(and(eq(appointmentPayments.appointmentId, id), eq(appointmentPayments.kind, 'booking_fee'), eq(appointmentPayments.status, 'paid')))) as [
    { feePaid: number | null },
  ]

  const { saleId, statements } = await prepareSale(
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

  try {
    await atomic([
      guard(
        exists(db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, id), eq(appointments.status, 'booked')))),
        'NOT_BOOKED',
      ),
      ...statements,
    ])
  } catch (error) {
    // A second tap (or a second device) opened the checkout first: the
    // unique index on live checkouts stopped this one. Hand back that one.
    if (isUniqueViolation(error, 'barber_sales.appointment_id')) {
      const winner = await openCheckout(id)
      if (winner) return getSale(barberId, winner)
    }
    throw error
  }
  return getSale(barberId, saleId)
}

/** The appointment's live (non-void) checkout, if it has one. */
async function openCheckout(appointmentId: string): Promise<string | null> {
  const [open] = await db
    .select({ id: barberSales.id })
    .from(barberSales)
    .where(and(eq(barberSales.appointmentId, appointmentId), ne(barberSales.status, 'void')))
    .limit(1)
  return open?.id ?? null
}
