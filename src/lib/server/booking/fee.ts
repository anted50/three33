import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, changed } from '~/db/atomic'
import { appointments } from '~/db/schema'
import { assert } from '~/lib/assert'
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
  const [appointment] = await db
    .select({ status: appointments.status, invoiceId: appointments.qpayInvoiceId, fee: appointments.bookingFee })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1)
  if (!appointment) throw notFound('Booking')
  if (appointment.status !== 'pending') return { status: appointment.status, checked: false }
  // No invoice yet: the hold is still being written (book.ts), nothing to ask.
  if (!appointment.invoiceId) return { status: appointment.status, checked: false }
  assert(Number.isInteger(appointment.fee), 'a booking fee is whole mungu')
  assert(appointment.fee > 0, 'an online hold always carries a fee')

  const claimed = await claimCheck(appointmentId)
  if (!claimed) return { status: appointment.status, checked: false }

  const result = await getQpayProvider().checkInvoice(appointment.invoiceId, appointment.fee)
  if (result.outcome !== 'paid') return { status: appointment.status, checked: true, outcome: result.outcome }
  // payments_payment_id_key needs it, and a paid check always names one.
  assert(result.providerPaymentId, 'a paid QPay check carries its payment id')

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

/**
 * Takes the right to ask QPay now, at most once per CHECK_INTERVAL_MS per
 * booking. Claimed before the call, so concurrent polls can't all reach QPay.
 */
async function claimCheck(appointmentId: string): Promise<boolean> {
  const now = new Date()
  const claimed = await db
    .update(appointments)
    .set({ lastCheckedAt: now })
    .where(
      and(
        eq(appointments.id, appointmentId),
        or(isNull(appointments.lastCheckedAt), lt(appointments.lastCheckedAt, new Date(now.getTime() - CHECK_INTERVAL_MS))),
      ),
    )
    .returning({ id: appointments.id })
  assert(claimed.length <= 1, 'an appointment id matches one row')
  return claimed.length === 1
}
