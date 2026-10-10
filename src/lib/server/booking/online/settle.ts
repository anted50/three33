import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '~/db'
import { appointmentEvents, appointmentPayments, appointments } from '~/db/schema'
import { notFound } from '../../api/errors'
import { getQpayProvider } from '../../payments/qpay'
import { sendConfirmationInBackground } from '../emails/confirmation'
import { creditFeePayment } from '../ledger'

/**
 * Confirms an online booking when QPay says its fee is paid. This — and the
 * barber entering a booking themselves — are the only two ways a booking
 * becomes confirmed. One transaction: fee paid, appointment booked,
 * 'created' event, ledger row. The confirmation email goes out after commit.
 *
 * Called by the customer's page polling, by QPay's callback, and by the
 * sweep; the status guards let exactly one of them win.
 */

const CHECK_INTERVAL_MS = 3_000

export async function checkBookingFee(paymentId: string) {
  const [row] = await db
    .select({ payment: appointmentPayments, barberId: appointments.barberId })
    .from(appointmentPayments)
    .innerJoin(appointments, eq(appointments.id, appointmentPayments.appointmentId))
    .where(eq(appointmentPayments.id, paymentId))
    .limit(1)
  if (!row) throw notFound('Payment')
  const { payment } = row
  if (payment.status !== 'pending' || !payment.qpayInvoiceId) return { status: payment.status, checked: false }

  const claimed = await db
    .update(appointmentPayments)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(appointmentPayments.id, paymentId),
        or(isNull(appointmentPayments.lastCheckedAt), lt(appointmentPayments.lastCheckedAt, new Date(Date.now() - CHECK_INTERVAL_MS))),
      ),
    )
    .returning({ id: appointmentPayments.id })
  if (claimed.length === 0) return { status: payment.status, checked: false }

  const result = await getQpayProvider().checkInvoice(payment.qpayInvoiceId, payment.amount)
  if (result.outcome !== 'paid') return { status: payment.status, checked: true, outcome: result.outcome }

  const confirmed = await db.transaction(async (tx) => {
    const paid = await tx
      .update(appointmentPayments)
      .set({ status: 'paid', paidAt: new Date(), qpayPaymentId: result.providerPaymentId, rawCallback: result.raw })
      .where(and(eq(appointmentPayments.id, paymentId), eq(appointmentPayments.status, 'pending')))
      .returning({ id: appointmentPayments.id })
    if (paid.length === 0) return false

    await tx
      .update(appointments)
      .set({ status: 'booked', confirmedAt: new Date(), expiresAt: null })
      .where(and(eq(appointments.id, payment.appointmentId), eq(appointments.status, 'pending')))
    await tx.insert(appointmentEvents).values({ appointmentId: payment.appointmentId, kind: 'created', note: 'Booking fee paid online' })
    await creditFeePayment(tx, { barberId: row.barberId, appointmentPaymentId: paymentId, amount: payment.amount })
    return true
  })

  if (confirmed) sendConfirmationInBackground(payment.appointmentId)
  return { status: 'paid' as const, checked: true, outcome: result.outcome }
}
