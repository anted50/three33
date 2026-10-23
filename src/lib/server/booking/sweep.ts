import { and, eq, lt } from 'drizzle-orm'
import { db } from '~/db'
import { appointments } from '~/db/schema'
import { getQpayProvider } from '../payments/qpay'
import { checkBookingFee } from './fee'

/**
 * The booking sweep (POST /api/v1/jobs/booking-sweep, and its Cron Trigger).
 *
 * Unpaid holds past expires_at are DELETED — "nothing a customer submits is
 * kept unless money arrives". QPay is asked one last time first (a
 * last-second payment still confirms the booking), and the invoice is
 * cancelled before the row goes, so a payment can never land with nothing to
 * match it. If the cancel fails, the hold stays for the next run.
 *
 * Idempotent; one failure never stops the rest.
 */
export async function sweepBooking() {
  const tally = { holdsConfirmed: 0, holdsDeleted: 0, holdsKept: 0, errors: 0 }

  const expired = await db
    .select({ id: appointments.id, bookingNo: appointments.bookingNo, invoiceId: appointments.qpayInvoiceId })
    .from(appointments)
    .where(and(eq(appointments.status, 'pending'), lt(appointments.expiresAt, new Date())))
    .limit(200)

  for (const hold of expired) {
    try {
      tally[await retireHold(hold)]++
    } catch (error) {
      tally.errors++
      console.error(`booking sweep: hold ${hold.bookingNo}`, error)
    }
  }
  return tally
}

async function retireHold(hold: { id: string; invoiceId: string | null }) {
  if (hold.invoiceId) {
    // Last look, unthrottled: clear the poll throttle first.
    await db.update(appointments).set({ lastCheckedAt: null }).where(eq(appointments.id, hold.id))
    const checked = await checkBookingFee(hold.id)
    if (checked.status === 'booked') return 'holdsConfirmed'
    try {
      await getQpayProvider().cancelInvoice(hold.invoiceId)
    } catch (error) {
      console.error(`booking sweep: cancel failed for invoice ${hold.invoiceId}; keeping the hold`, error)
      return 'holdsKept'
    }
  }
  // The status guard means a hold confirmed a moment ago is never deleted.
  await db.delete(appointments).where(and(eq(appointments.id, hold.id), eq(appointments.status, 'pending')))
  return 'holdsDeleted'
}
