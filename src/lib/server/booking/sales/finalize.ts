import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '~/db'
import { guard, type Statement } from '~/db/atomic'
import { appointmentEvents, appointments, barberSalePayments, barberSales } from '~/db/schema'
import { deductStock, type StockLine } from './stock'

/**
 * Closing a sale once its paid payments cover what is due (total − credit).
 * If the sale is an appointment checkout, the appointment is completed in the
 * same batch — "service finished and paid" is one event, not two. Product
 * lines take their stock in the same batch too (see stock.ts): `strictStock`
 * refuses when the shelf is short — right while the money is still only being
 * entered — and is off for QPay, which has already taken it.
 */

/** Whether `paid` covers the sale. */
export const isCovered = (sale: { total: number; credit: number }, paid: number) => paid >= sale.total - sale.credit

/**
 * The statements that close a covered sale. The caller decides it is covered
 * (isCovered) from state its batch guards with saleUnchanged.
 */
export function finalizeSale(
  sale: { id: string; appointmentId: string | null },
  stockLines: StockLine[],
  actorId: string | null,
  opts: { strictStock: boolean } = { strictStock: true },
): Statement[] {
  const now = new Date()
  const statements: Statement[] = [
    ...deductStock(stockLines, actorId, opts.strictStock),
    db.update(barberSales).set({ status: 'paid', paidAt: now }).where(eq(barberSales.id, sale.id)),
  ]

  if (sale.appointmentId) {
    statements.push(
      db
        .update(appointments)
        .set({ status: 'completed' })
        .where(and(eq(appointments.id, sale.appointmentId), eq(appointments.status, 'booked'))),
      // Only if that update completed it: changes() is still the update's.
      db.insert(appointmentEvents).select(sql`
        select ${crypto.randomUUID()}, ${sale.appointmentId}, 'completed', null, null, ${actorId}, null, ${now.getTime()}
        where changes() > 0
      `),
    )
  }
  return statements
}

/**
 * Batch guard: the sale is still `status` and its other payments still add up
 * to what was read — `paid` and `pending`, leaving out `except` (the payment
 * this batch is about). Everything a payment's ledger split and the "is it
 * covered now?" decision were computed from. Trips SALE_CHANGED, which
 * callers answer by re-reading and trying again (retryOnGuard).
 */
export function saleUnchanged(
  saleId: string,
  read: { status: string; paid: number; pending: number },
  except: string | null,
): Statement {
  const others = (status: 'paid' | 'pending') => sql`(
    select coalesce(sum(${barberSalePayments.amount}), 0) from ${barberSalePayments}
    where ${barberSalePayments.saleId} = ${saleId}
      and ${barberSalePayments.status} = ${status}
      ${except ? sql`and ${ne(barberSalePayments.id, except)}` : sql``}
  )`
  return guard(
    sql`(select ${barberSales.status} from ${barberSales} where ${barberSales.id} = ${saleId}) = ${read.status}
      and ${others('paid')} = ${read.paid}
      and ${others('pending')} = ${read.pending}`,
    'SALE_CHANGED',
  )
}
