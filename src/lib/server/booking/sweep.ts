import { and, eq, lt } from 'drizzle-orm'
import { db } from '~/db'
import { appointmentPayments, appointments, barberSalePayments } from '~/db/schema'
import { getQpayProvider } from '../payments/qpay'
import { checkBookingFee } from './online/settle'
import { checkSalePayment } from './sales/settle'

/**
 * The booking side of the scheduled sweep (scripts/booking-sweep.ts).
 *
 * 1. Unpaid holds past expires_at are DELETED — "nothing a customer submits
 *    is kept unless money arrives". QPay is asked one last time first; the
 *    invoice is cancelled before the row goes, so a payment can never land
 *    with nothing to match it. If the cancel fails, the hold stays for the
 *    next run.
 * 2. POS QPay payments whose callback never came are checked, so a barber
 *    closing the screen can't strand a paid payment as pending. After a day
 *    unpaid, the invoice is withdrawn and the payment marked failed.
 *
 * Every step is idempotent; one failure never stops the rest.
 */

const POS_CHECK_AFTER_MS = 5 * 60 * 1000
const POS_GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000

export async function sweepBooking() {
  const tally = { holdsConfirmed: 0, holdsDeleted: 0, holdsKept: 0, posSettled: 0, posWithdrawn: 0, errors: 0 }

  const expired = await db
    .select({ id: appointments.id, bookingNo: appointments.bookingNo })
    .from(appointments)
    .where(and(eq(appointments.status, 'pending'), lt(appointments.expiresAt, new Date())))
    .limit(200)

  for (const hold of expired) {
    try {
      const outcome = await retireHold(hold.id)
      tally[outcome]++
    } catch (error) {
      tally.errors++
      console.error(`booking sweep: hold ${hold.bookingNo}`, error)
    }
  }

  const pendingPos = await db
    .select({ id: barberSalePayments.id, createdAt: barberSalePayments.createdAt, invoiceId: barberSalePayments.qpayInvoiceId })
    .from(barberSalePayments)
    .where(
      and(
        eq(barberSalePayments.method, 'qpay'),
        eq(barberSalePayments.status, 'pending'),
        lt(barberSalePayments.createdAt, new Date(Date.now() - POS_CHECK_AFTER_MS)),
      ),
    )
    .limit(200)

  for (const p of pendingPos) {
    try {
      const result = await checkSalePayment(p.id)
      if (result.status === 'paid') tally.posSettled++
      else if (p.createdAt < new Date(Date.now() - POS_GIVE_UP_AFTER_MS)) {
        if (p.invoiceId) await getQpayProvider().cancelInvoice(p.invoiceId)
        await db
          .update(barberSalePayments)
          .set({ status: 'failed' })
          .where(and(eq(barberSalePayments.id, p.id), eq(barberSalePayments.status, 'pending')))
        tally.posWithdrawn++
      }
    } catch (error) {
      tally.errors++
      console.error(`booking sweep: POS payment ${p.id}`, error)
    }
  }

  return tally
}

async function retireHold(appointmentId: string): Promise<'holdsConfirmed' | 'holdsDeleted' | 'holdsKept'> {
  const [fee] = await db
    .select()
    .from(appointmentPayments)
    .where(and(eq(appointmentPayments.appointmentId, appointmentId), eq(appointmentPayments.status, 'pending')))
    .limit(1)

  if (fee?.qpayInvoiceId) {
    // Last look: a customer who paid at the final second still gets their booking.
    await db.update(appointmentPayments).set({ lastCheckedAt: null }).where(eq(appointmentPayments.id, fee.id))
    const checked = await checkBookingFee(fee.id)
    if (checked.status === 'paid') return 'holdsConfirmed'
    try {
      await getQpayProvider().cancelInvoice(fee.qpayInvoiceId)
    } catch (error) {
      console.error(`booking sweep: cancel failed for invoice ${fee.qpayInvoiceId}; keeping the hold`, error)
      return 'holdsKept'
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(appointmentPayments)
      .where(and(eq(appointmentPayments.appointmentId, appointmentId), eq(appointmentPayments.status, 'pending')))
    // Lines cascade with the appointment. The status guard means a hold that
    // got confirmed a moment ago is never deleted.
    await tx.delete(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending')))
  })
  return 'holdsDeleted'
}
