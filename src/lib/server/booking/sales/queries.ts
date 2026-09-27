import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barberSaleLines, barberSalePayments, barberSales } from '~/db/schema'
import { notFound } from '../../api/errors'
import { isoDate } from '../../api/input'
import { addDays, atLocal } from '../time'

/** Reading a barber's POS sales. Every query is scoped to the barber. */

export const salesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['open', 'paid', 'void']).optional(),
})

const paymentColumns = {
  id: barberSalePayments.id,
  method: barberSalePayments.method,
  amount: barberSalePayments.amount,
  status: barberSalePayments.status,
  qpayInvoiceId: barberSalePayments.qpayInvoiceId,
  invoicePayload: barberSalePayments.invoicePayload,
  paidAt: barberSalePayments.paidAt,
  createdAt: barberSalePayments.createdAt,
}

export async function getSale(barberId: string, saleId: string) {
  const [sale] = await db
    .select()
    .from(barberSales)
    .where(and(eq(barberSales.id, saleId), eq(barberSales.barberId, barberId)))
    .limit(1)
  if (!sale) throw notFound('Sale')

  const lines = await db.select().from(barberSaleLines).where(eq(barberSaleLines.saleId, saleId)).orderBy(asc(barberSaleLines.sortOrder))
  const payments = await db.select(paymentColumns).from(barberSalePayments).where(eq(barberSalePayments.saleId, saleId)).orderBy(asc(barberSalePayments.createdAt))

  return { ...sale, lines, payments, ...amounts(sale, payments) }
}

/**
 * due        what the customer owes at the shop: total − credit
 * paid       confirmed so far
 * pending    QPay invoices issued but not yet paid
 * remaining  what can still be charged: due − paid − pending
 */
export function amounts(
  sale: { total: number; credit: number },
  payments: Array<{ amount: number; status: string }>,
) {
  const due = sale.total - sale.credit
  const paid = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const pending = payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0)
  return { due, paid, pending, remaining: Math.max(0, due - paid - pending) }
}

export async function listSales(barberId: string, query: z.infer<typeof salesQuery>) {
  const conditions = [eq(barberSales.barberId, barberId)]
  if (query.from) conditions.push(gte(barberSales.createdAt, atLocal(query.from, '00:00')))
  if (query.to) conditions.push(lt(barberSales.createdAt, atLocal(addDays(query.to, 1), '00:00')))
  if (query.status) conditions.push(eq(barberSales.status, query.status))
  return db.select().from(barberSales).where(and(...conditions)).orderBy(desc(barberSales.createdAt)).limit(200)
}
