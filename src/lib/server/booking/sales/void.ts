import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, changed, exists } from '~/db/atomic'
import { barberSalePayments, barberSales } from '~/db/schema'
import { conflict } from '../../api/errors'
import { getSale } from './queries'
import { cancelSalePayment } from './settle'

/**
 * Abandons an open sale. Only possible while no money has been taken: a paid
 * payment is real money and stays on the books. Pending QPay invoices are
 * withdrawn first — and if one turns out to have been paid, the void stops.
 */
export async function voidSale(barberId: string, saleId: string) {
  const sale = await getSale(barberId, saleId)
  if (sale.status !== 'open') throw conflict('SALE_CLOSED', `Sale is ${sale.status}`)

  for (const p of sale.payments.filter((p) => p.method === 'qpay' && p.status === 'pending')) {
    await cancelSalePayment(p.id, barberId)
  }

  const [paid] = await db
    .select({ id: barberSalePayments.id })
    .from(barberSalePayments)
    .where(and(eq(barberSalePayments.saleId, saleId), eq(barberSalePayments.status, 'paid')))
    .limit(1)
  if (paid) throw conflict('HAS_PAYMENTS', 'Money was already taken for this sale; it cannot be voided')

  // Both conditions again, in the update itself: a payment may have landed
  // since they were read (a QPay invoice paid at the last second).
  await atomic([
    db
      .update(barberSales)
      .set({ status: 'void', voidedAt: new Date() })
      .where(
        and(
          eq(barberSales.id, saleId),
          eq(barberSales.barberId, barberId),
          eq(barberSales.status, 'open'),
          sql`not ${exists(
            db
              .select({ id: barberSalePayments.id })
              .from(barberSalePayments)
              .where(and(eq(barberSalePayments.saleId, saleId), eq(barberSalePayments.status, 'paid'))),
          )}`,
        ),
      ),
    changed('HAS_PAYMENTS'),
  ])
  return getSale(barberId, saleId)
}
