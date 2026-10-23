import { and, eq, isNull, lt, ne, or } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, changed, retryOnGuard } from '~/db/atomic'
import { barberSalePayments, barberSales } from '~/db/schema'
import { isGuardFailure } from '../../api/db-errors'
import { conflict, notFound } from '../../api/errors'
import { getQpayProvider } from '../../payments/qpay'
import { creditSalePayment } from '../ledger'
import { finalizeSale, isCovered, saleUnchanged } from './finalize'
import { amounts } from './queries'
import { undeductedLines } from './stock'

/**
 * QPay's side of POS payments. QPay is the only method we can confirm by API,
 * so a QPay payment is paid only when QPay itself says so — never on a
 * callback body, never on the barber's word.
 */

/** A poll or callback asks QPay at most this often per payment. */
const CHECK_INTERVAL_MS = 3_000

async function loadPayment(paymentId: string, barberId?: string) {
  const [row] = await db
    .select({ payment: barberSalePayments, barberId: barberSales.barberId })
    .from(barberSalePayments)
    .innerJoin(barberSales, eq(barberSales.id, barberSalePayments.saleId))
    .where(eq(barberSalePayments.id, paymentId))
    .limit(1)
  if (!row || (barberId && row.barberId !== barberId)) throw notFound('Payment')
  return row
}

/**
 * Asks QPay whether a pending payment has landed and, if so, marks it paid,
 * writes the ledger and closes the sale if it is now covered — one atomic
 * batch. Idempotent: the status guard lets exactly one caller win.
 * `barberId` scopes it for the barber API; the public callback omits it.
 */
export async function checkSalePayment(paymentId: string, barberId?: string) {
  const { payment, barberId: owner } = await loadPayment(paymentId, barberId)
  if (payment.method !== 'qpay' || payment.status !== 'pending' || !payment.qpayInvoiceId) {
    return { status: payment.status, checked: false }
  }

  const claimed = await db
    .update(barberSalePayments)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(barberSalePayments.id, paymentId),
        or(isNull(barberSalePayments.lastCheckedAt), lt(barberSalePayments.lastCheckedAt, new Date(Date.now() - CHECK_INTERVAL_MS))),
      ),
    )
    .returning({ id: barberSalePayments.id })
  if (claimed.length === 0) return { status: payment.status, checked: false }

  const result = await getQpayProvider().checkInvoice(payment.qpayInvoiceId, payment.amount)
  if (result.outcome !== 'paid') return { status: payment.status, checked: true, outcome: result.outcome }

  try {
    await retryOnGuard('SALE_CHANGED', async () => {
      const [sale] = await db.select().from(barberSales).where(eq(barberSales.id, payment.saleId)).limit(1)
      if (!sale) throw notFound('Sale')
      const others = await db
        .select({ amount: barberSalePayments.amount, status: barberSalePayments.status })
        .from(barberSalePayments)
        .where(and(eq(barberSalePayments.saleId, payment.saleId), ne(barberSalePayments.id, paymentId)))
      const { paid, pending } = amounts({ total: 0, credit: 0 }, others)
      // A payment can land on a sale that is no longer open; it is still real
      // money and is still credited — the sale just isn't closed by it.
      const covered = sale.status === 'open' && isCovered(sale, paid + payment.amount)

      await atomic([
        saleUnchanged(payment.saleId, { status: sale.status, paid, pending }, paymentId),
        // Exactly one caller moves it out of pending; the rest stop here.
        db
          .update(barberSalePayments)
          .set({ status: 'paid', paidAt: new Date(), qpayPaymentId: result.providerPaymentId, rawCallback: result.raw })
          .where(and(eq(barberSalePayments.id, paymentId), eq(barberSalePayments.status, 'pending'))),
        changed('PAYMENT_NOT_PENDING'),
        ...(await creditSalePayment({
          barberId: owner,
          saleId: payment.saleId,
          salePaymentId: paymentId,
          method: 'qpay',
          amount: payment.amount,
          actorId: null,
          paidBefore: paid,
        })),
        // The customer has paid: stock can't refuse it now (stock.ts, lenient).
        ...(covered ? finalizeSale(sale, await undeductedLines(payment.saleId), null, { strictStock: false }) : []),
      ])
    })
  } catch (error) {
    // Someone else (the callback, a poll, the sweep) settled it first.
    if (!isGuardFailure(error, 'PAYMENT_NOT_PENDING')) throw error
  }
  return { status: 'paid' as const, checked: true, outcome: result.outcome }
}

/**
 * Withdraws a pending QPay invoice. Checks once more first: if the customer
 * paid in the meantime, that payment is kept and settled instead.
 */
export async function cancelSalePayment(paymentId: string, barberId: string) {
  const { payment } = await loadPayment(paymentId, barberId)
  if (payment.method !== 'qpay' || payment.status !== 'pending') {
    throw conflict('NOT_PENDING', 'Only a pending QPay payment can be cancelled')
  }
  if (payment.qpayInvoiceId) {
    const result = await getQpayProvider().checkInvoice(payment.qpayInvoiceId, payment.amount)
    if (result.outcome === 'paid') {
      await db.update(barberSalePayments).set({ lastCheckedAt: null }).where(eq(barberSalePayments.id, paymentId))
      return checkSalePayment(paymentId, barberId)
    }
    await getQpayProvider().cancelInvoice(payment.qpayInvoiceId).catch((error) => {
      console.error(`QPay cancel failed for sale payment ${paymentId}`, error)
    })
  }
  await db
    .update(barberSalePayments)
    .set({ status: 'failed' })
    .where(and(eq(barberSalePayments.id, paymentId), eq(barberSalePayments.status, 'pending')))
  return { status: 'failed' as const, checked: true }
}
