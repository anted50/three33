import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, changed } from '~/db/atomic'
import { appointments } from '~/db/schema'
import { isGuardFailure } from '../api/db-errors'
import { notFound } from '../api/errors'
import { inBackground } from '../background'
import { getQpayProvider } from '../payments/qpay'
import { sendConfirmation } from './emails/confirmation'

/**
 * Confirms a booking when QPay says its fee is paid — the only way a booking
 * becomes confirmed. Called by the customer's page polling, by QPay's
 * callback, and by the sweep; the status guard lets exactly one of them win,
 * and the confirmation email goes out after it.
 */

/** A poll or callback asks QPay at most this often per booking. */
const CHECK_INTERVAL_MS = 3_000

export async function checkBookingFee(appointmentId: string) {
  const [a] = await db
    .select({ status: appointments.status, invoiceId: appointments.qpayInvoiceId, fee: appointments.bookingFee })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1)
  if (!a) throw notFound('Booking')
  if (a.status !== 'pending' || !a.invoiceId) return { status: a.status, checked: false }

  // Claimed before the call, so concurrent polls can't all reach QPay.
  const claimed = await db
    .update(appointments)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(appointments.id, appointmentId),
        or(isNull(appointments.lastCheckedAt), lt(appointments.lastCheckedAt, new Date(Date.now() - CHECK_INTERVAL_MS))),
      ),
    )
    .returning({ id: appointments.id })
  if (claimed.length === 0) return { status: a.status, checked: false }

  const result = await getQpayProvider().checkInvoice(a.invoiceId, a.fee)
  if (result.outcome !== 'paid') return { status: a.status, checked: true, outcome: result.outcome }

  try {
    await atomic([
      db
        .update(appointments)
        .set({ status: 'booked', paidAt: new Date(), qpayPaymentId: result.providerPaymentId, expiresAt: null })
        .where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending'))),
      changed('ALREADY_CONFIRMED'),
    ])
  } catch (error) {
    // Someone else (the callback, a poll, the sweep) confirmed it first.
    if (isGuardFailure(error, 'ALREADY_CONFIRMED')) return { status: 'booked' as const, checked: true, outcome: result.outcome }
    throw error
  }

  inBackground(`booking confirmation ${appointmentId}`, sendConfirmation(appointmentId))
  return { status: 'booked' as const, checked: true, outcome: result.outcome }
}
