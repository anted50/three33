import { and, eq } from 'drizzle-orm'
import { db } from '~/db'
import { barberSalePayments, barberSales } from '~/db/schema'
import { conflict, notFound } from '../../api/errors'
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

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: barberSales.status })
      .from(barberSales)
      .where(and(eq(barberSales.id, saleId), eq(barberSales.barberId, barberId)))
      .for('update')
      .limit(1)
    if (!locked) throw notFound('Sale')
    if (locked.status !== 'open') throw conflict('SALE_CLOSED', `Sale is ${locked.status}`)

    const [paid] = await tx
      .select({ id: barberSalePayments.id })
      .from(barberSalePayments)
      .where(and(eq(barberSalePayments.saleId, saleId), eq(barberSalePayments.status, 'paid')))
      .limit(1)
    if (paid) throw conflict('HAS_PAYMENTS', 'Money was already taken for this sale; it cannot be voided')

    await tx.update(barberSales).set({ status: 'void', voidedAt: new Date() }).where(eq(barberSales.id, saleId))
  })
  return getSale(barberId, saleId)
}
