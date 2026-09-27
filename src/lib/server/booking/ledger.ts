import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { barberLedger, barberSaleLines, barberSalePayments, barberSales, type PaymentMethod } from '~/db/schema'
import type { Tx } from './db'
import { allocate, splitPayment } from './ledger-split'
import { ratesFor } from './terms'

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

  const rates = await ratesFor(input.barberId, tx)
  const lines = splitPayment(input.method, allocate(input.amount, productDue, paidBefore), rates)
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

/**
 * The online booking fee, credited when QPay confirms it. The fee pays for
 * services, so it's a service share at the barber's rate (100% while the
 * owner is the barber). Unique on (appointment_payment_id, kind).
 */
export async function creditFeePayment(
  tx: Tx,
  input: { barberId: string; appointmentPaymentId: string; amount: number },
) {
  const rates = await ratesFor(input.barberId, tx)
  const lines = splitPayment('qpay', { service: input.amount, product: 0 }, rates)
  if (lines.length === 0) return
  await tx.insert(barberLedger).values(
    lines.map((line) => ({ ...line, barberId: input.barberId, appointmentPaymentId: input.appointmentPaymentId })),
  )
}
