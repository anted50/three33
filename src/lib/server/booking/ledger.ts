import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { db } from '~/db'
import type { Statement } from '~/db/atomic'
import { barberLedger, barberSaleLines, barberSalePayments, type PaymentMethod } from '~/db/schema'
import { allocate, splitPayment } from './ledger-split'
import { ratesFor } from './terms'

/**
 * barber_ledger rows for one paid POS payment. Returned as a statement for the
 * same batch that marks the payment paid — the money and its accounting land
 * together or not at all. The unique index on (sale_payment_id, kind) makes a
 * second attempt fail instead of double-crediting.
 *
 * In a sale with products and services, each payment covers the products
 * first (see ledger-split.ts), so the split depends on `paidBefore` — what the
 * sale's other paid payments add up to. The caller reads that, and its batch
 * must guard that it is unchanged (see sales/finalize.ts, saleUnchanged), or
 * two payments landing at once could both claim the same product money.
 */
export async function creditSalePayment(input: {
  barberId: string
  saleId: string
  salePaymentId: string
  method: PaymentMethod
  amount: number
  actorId: string | null
  paidBefore: number
}): Promise<Statement[]> {
  const productLines = await db
    .select({ unitAmount: barberSaleLines.unitAmount, qty: barberSaleLines.qty })
    .from(barberSaleLines)
    .where(and(eq(barberSaleLines.saleId, input.saleId), isNotNull(barberSaleLines.skuSnapshot)))
  const productDue = productLines.reduce((sum, l) => sum + l.unitAmount * l.qty, 0)

  const rates = await ratesFor(input.barberId, db)
  const lines = splitPayment(input.method, allocate(input.amount, productDue, input.paidBefore), rates)
  if (lines.length === 0) return []

  // In an array, never returned bare: an async function awaits a returned
  // query builder (it is thenable), which would run the insert right here,
  // outside the caller's batch.
  return [
    db.insert(barberLedger).values(
      lines.map((line) => ({
        ...line,
        barberId: input.barberId,
        salePaymentId: input.salePaymentId,
        actorId: input.actorId,
      })),
    ),
  ]
}

/** What a sale's paid payments add up to, leaving one out. */
export async function paidOnSale(saleId: string, except: string | null): Promise<number> {
  const rows = await db
    .select({ amount: barberSalePayments.amount })
    .from(barberSalePayments)
    .where(
      and(
        eq(barberSalePayments.saleId, saleId),
        eq(barberSalePayments.status, 'paid'),
        except ? ne(barberSalePayments.id, except) : undefined,
      ),
    )
  return rows.reduce((sum, p) => sum + p.amount, 0)
}

/**
 * The online booking fee, credited when QPay confirms it. The fee pays for
 * services, so it's a service share at the barber's rate (100% while the
 * owner is the barber). Unique on (appointment_payment_id, kind).
 */
export async function creditFeePayment(input: {
  barberId: string
  appointmentPaymentId: string
  amount: number
}): Promise<Statement[]> {
  const rates = await ratesFor(input.barberId, db)
  const lines = splitPayment('qpay', { service: input.amount, product: 0 }, rates)
  if (lines.length === 0) return []
  // In an array for the same reason as creditSalePayment.
  return [
    db.insert(barberLedger).values(
      lines.map((line) => ({ ...line, barberId: input.barberId, appointmentPaymentId: input.appointmentPaymentId })),
    ),
  ]
}
