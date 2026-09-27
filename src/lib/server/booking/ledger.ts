import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { barberLedger, barberSaleLines, barberSalePayments, barberSales, type PaymentMethod } from '~/db/schema'
import type { Tx } from './db'
import { allocate, splitPayment } from './ledger-split'
import { requireTerms } from './terms'

/**
 * Writes the barber_ledger rows for one paid POS payment, inside the same
 * transaction that marked it paid — the money and its accounting land
 * together or not at all. The unique index on (sale_payment_id, kind) makes a
 * second attempt fail instead of double-crediting.
 *
 * In a sale with products and services, each payment covers the products
 * first (see ledger-split.ts). The sale row is locked so two payments landing
 * at once can't both claim the same product money.
 */
export async function creditSalePayment(
  tx: Tx,
  input: {
    barberId: string
    saleId: string
    salePaymentId: string
    method: PaymentMethod
    amount: number
    actorId: string | null
  },
) {
  await tx.select({ id: barberSales.id }).from(barberSales).where(eq(barberSales.id, input.saleId)).for('update')

  const productLines = await tx
    .select({ unitAmount: barberSaleLines.unitAmount, qty: barberSaleLines.qty })
    .from(barberSaleLines)
    .where(and(eq(barberSaleLines.saleId, input.saleId), isNotNull(barberSaleLines.skuSnapshot)))
  const productDue = productLines.reduce((sum, l) => sum + l.unitAmount * l.qty, 0)

  const earlier = await tx
    .select({ amount: barberSalePayments.amount })
    .from(barberSalePayments)
    .where(
      and(
        eq(barberSalePayments.saleId, input.saleId),
        eq(barberSalePayments.status, 'paid'),
        ne(barberSalePayments.id, input.salePaymentId),
      ),
    )
  const paidBefore = earlier.reduce((sum, p) => sum + p.amount, 0)

  const terms = await requireTerms(input.barberId, tx)
  const lines = splitPayment(input.method, allocate(input.amount, productDue, paidBefore), terms)
  if (lines.length === 0) return

  await tx.insert(barberLedger).values(
    lines.map((line) => ({
      ...line,
      barberId: input.barberId,
      salePaymentId: input.salePaymentId,
      actorId: input.actorId,
    })),
  )
}
