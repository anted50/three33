import { and, eq, sum } from 'drizzle-orm'
import { appointmentEvents, appointments, barberSalePayments, barberSales } from '~/db/schema'
import type { Tx } from '../db'
import { deductStock } from './stock'

/**
 * Closes a sale once its paid payments cover what is due (total − credit).
 * If the sale is an appointment checkout, the appointment is completed in the
 * same transaction — "service finished and paid" is one event, not two.
 * Product lines take their stock in the same transaction (see stock.ts):
 * `strictStock` refuses when the shelf is short — right while the money is
 * still only being entered — and is off for QPay, which has already taken it.
 * Safe to call after every payment; it does nothing until the sale is covered.
 */
export async function finalizeIfCovered(
  tx: Tx,
  saleId: string,
  actorId: string | null,
  opts: { strictStock: boolean } = { strictStock: true },
): Promise<boolean> {
  const [sale] = await tx.select().from(barberSales).where(eq(barberSales.id, saleId)).for('update').limit(1)
  if (!sale || sale.status !== 'open') return false

  const [{ paid }] = (await tx
    .select({ paid: sum(barberSalePayments.amount).mapWith(Number) })
    .from(barberSalePayments)
    .where(and(eq(barberSalePayments.saleId, saleId), eq(barberSalePayments.status, 'paid')))) as [{ paid: number | null }]

  if ((paid ?? 0) < sale.total - sale.credit) return false

  await deductStock(tx, saleId, actorId, opts.strictStock)

  const now = new Date()
  await tx.update(barberSales).set({ status: 'paid', paidAt: now }).where(eq(barberSales.id, saleId))

  if (sale.appointmentId) {
    const done = await tx
      .update(appointments)
      .set({ status: 'completed' })
      .where(and(eq(appointments.id, sale.appointmentId), eq(appointments.status, 'booked')))
      .returning({ id: appointments.id })
    if (done.length > 0) {
      await tx.insert(appointmentEvents).values({ appointmentId: sale.appointmentId, kind: 'completed', actorId })
    }
  }
  return true
}
