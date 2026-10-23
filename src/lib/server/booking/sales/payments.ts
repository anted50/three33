import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, retryOnGuard } from '~/db/atomic'
import { barberSalePayments, barberSales } from '~/db/schema'
import { ApiError, badRequest, conflict, notFound } from '../../api/errors'
import { mungu } from '../../api/input'
import type { Staff } from '../../api/staff'
import { env } from '../../env'
import { signCallbackToken } from '../../payments/callback-token'
import { getQpayProvider } from '../../payments/qpay'
import { creditSalePayment } from '../ledger'
import { invoiceRef } from '../refs'
import { finalizeSale, isCovered, saleUnchanged } from './finalize'
import { amounts, getSale } from './queries'
import { assertStock, undeductedLines } from './stock'

/**
 * Taking money for a sale. Any mix of methods, as long as the total never
 * exceeds what is due.
 *
 *   cash / pos / bank_transfer  recorded as paid on entry — the barber's word;
 *                               that money lands where no API can see it
 *   qpay                        an invoice is issued; the payment is paid only
 *                               once QPay confirms it (see settle.ts)
 */

export const paymentInput = z.object({
  method: z.enum(['qpay', 'cash', 'pos', 'bank_transfer']),
  amount: mungu.min(1),
})

export async function addPayment(staff: Staff, barberId: string, saleId: string, input: z.infer<typeof paymentInput>) {
  if (input.method === 'qpay' && input.amount % 100 !== 0) {
    throw badRequest('QPay can only charge whole tugrik')
  }

  const paymentId = crypto.randomUUID()

  // Re-read and rebuilt if another payment lands on the sale in between.
  await retryOnGuard('SALE_CHANGED', async () => {
    const [sale] = await db
      .select()
      .from(barberSales)
      .where(and(eq(barberSales.id, saleId), eq(barberSales.barberId, barberId)))
      .limit(1)
    if (!sale) throw notFound('Sale')
    if (sale.status !== 'open') throw conflict('SALE_CLOSED', `Sale is ${sale.status}`)

    const existing = await db
      .select({ amount: barberSalePayments.amount, status: barberSalePayments.status })
      .from(barberSalePayments)
      .where(eq(barberSalePayments.saleId, saleId))
    // Before any money: a QPay invoice for goods that aren't there would take
    // money we then can't honour.
    await assertStock(db, saleId)

    const { paid, pending, remaining } = amounts(sale, existing)
    if (input.amount > remaining) {
      throw conflict('AMOUNT_TOO_HIGH', 'More than what is left to pay', { remaining })
    }

    const manual = input.method !== 'qpay'
    const covered = manual && isCovered(sale, paid + input.amount)

    await atomic([
      saleUnchanged(saleId, { status: sale.status, paid, pending }, paymentId),
      db.insert(barberSalePayments).values({
        id: paymentId,
        saleId,
        method: input.method,
        amount: input.amount,
        status: manual ? 'paid' : 'pending',
        paidAt: manual ? new Date() : null,
        receivedByUserId: staff.userId,
      }),
      ...(!manual
        ? []
        : await creditSalePayment({
          barberId,
          saleId,
          salePaymentId: paymentId,
          method: input.method,
          amount: input.amount,
          actorId: staff.userId,
          paidBefore: paid,
        })),
      ...(covered ? finalizeSale(sale, await undeductedLines(saleId), staff.userId) : []),
    ])
  })

  if (input.method === 'qpay') await issueInvoice(paymentId, saleId, input.amount)
  return getSale(barberId, saleId)
}

/** After the payment row is written: a slow bank API must not sit inside the write. */
async function issueInvoice(paymentId: string, saleId: string, amount: number) {
  const [sale] = await db.select({ saleNo: barberSales.saleNo }).from(barberSales).where(eq(barberSales.id, saleId)).limit(1)
  try {
    const invoice = await getQpayProvider().createInvoice({
      orderNo: invoiceRef(sale!.saleNo),
      amount,
      description: `Three33 ${sale!.saleNo}`,
      callbackUrl: salePaymentCallbackUrl(paymentId),
    })
    await db
      .update(barberSalePayments)
      .set({
        qpayInvoiceId: invoice.invoiceId,
        invoicePayload: { qrText: invoice.qrText, qrImage: invoice.qrImage, shortUrl: invoice.shortUrl, links: invoice.links },
      })
      .where(eq(barberSalePayments.id, paymentId))
  } catch (error) {
    console.error(`QPay invoice failed for sale payment ${paymentId}`, error)
    await db.update(barberSalePayments).set({ status: 'failed' }).where(eq(barberSalePayments.id, paymentId))
    throw new ApiError(502, 'QPAY_UNAVAILABLE', 'QPay did not issue an invoice; try again or take another method')
  }
}

/** Signed per payment, so the public callback can't be pointed at others. */
export const callbackSubject = (paymentId: string) => `sale-payment:${paymentId}`

function salePaymentCallbackUrl(paymentId: string): string {
  const url = new URL('/api/v1/public/qpay/sale-payment', env.APP_URL)
  url.searchParams.set('payment', paymentId)
  url.searchParams.set('t', signCallbackToken(callbackSubject(paymentId), env.QPAY_CALLBACK_SECRET))
  return url.toString()
}
