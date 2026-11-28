import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, gte, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic, exists, guard } from '~/db/atomic'
import { appointments, availability } from '~/db/schema'
import { assert } from '~/lib/assert'
import { isGuardFailure } from '../api/db-errors'
import { ApiError, badRequest, conflict } from '../api/errors'
import { email, phone } from '../api/input'
import { env } from '../env'
import { signCallbackToken } from '../payments/callback-token'
import { getQpayProvider } from '../payments/qpay'
import { loadBookingFee } from '../settings'
import { generateBookingNo } from './refs'
import { bookableService } from './services'
import { addMinutes } from './time'

/**
 * A customer booking a time. Nothing a customer submits is kept unless money
 * arrives, so this writes only a short-lived HOLD — the appointment as
 * `pending` — and asks QPay for the booking-fee invoice. The hold exists so
 * two customers can't pay for the same time (the no-overlap trigger counts
 * pending rows). Paid, the booking is confirmed and emailed (fee.ts); unpaid
 * by expires_at, the sweep deletes it (sweep.ts).
 *
 * Only inside a window the barber opened (schedule.ts).
 */

/** How long the customer has to pay the fee. Matches the QR's useful life. */
export const HOLD_MS = 15 * 60 * 1000

export const bookingInput = z.object({
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: phone,
  /** Required: it's where the confirmation goes. */
  customerEmail: email,
  note: z.string().trim().max(500).nullish(),
})

export async function createBooking(input: z.infer<typeof bookingInput>) {
  const fee = await loadBookingFee()
  if (!fee) throw conflict('BOOKING_OFF', 'Online booking is not open yet')
  assert(Number.isInteger(fee), 'loadBookingFee returns whole mungu')

  const service = await bookableService(input.serviceId)
  const startsAt = new Date(input.startsAt)
  const endsAt = addMinutes(startsAt, service.durationMinutes)
  assert(endsAt > startsAt, 'a service has a positive length')
  if (startsAt <= new Date()) throw badRequest('That time has passed')

  // Read first for the clear error; the same two checks run again inside the
  // batch, since a schedule edit or a second tab may land in between.
  const [window] = await db.select({ id: availability.id }).from(availability).where(windowCovers(startsAt, endsAt)).limit(1)
  if (!window) throw notAvailable()
  const [liveHold] = await db.select({ id: appointments.id }).from(appointments).where(liveHoldOf(input)).limit(1)
  if (liveHold) throw holdExists()

  const token = randomBytes(24).toString('base64url')
  const id = crypto.randomUUID()
  const bookingNo = generateBookingNo()
  const expiresAt = new Date(Date.now() + HOLD_MS)

  try {
    // A clash with another booking or hold aborts here with TIME_TAKEN
    // (the no-overlap trigger, mapped in api/db-errors.ts).
    await atomic([
      guard(exists(db.select({ id: availability.id }).from(availability).where(windowCovers(startsAt, endsAt))), 'NOT_AVAILABLE'),
      guard(sql`not ${exists(db.select({ id: appointments.id }).from(appointments).where(liveHoldOf(input)))}`, 'HOLD_EXISTS'),
      db.insert(appointments).values({
        id,
        bookingNo,
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        status: 'pending',
        startsAt,
        endsAt,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        note: input.note ?? null,
        bookingFee: fee,
        expiresAt,
        accessTokenHash: createHash('sha256').update(token).digest('hex'),
      }),
    ])
  } catch (error) {
    if (isGuardFailure(error, 'NOT_AVAILABLE')) throw notAvailable()
    if (isGuardFailure(error, 'HOLD_EXISTS')) throw holdExists()
    throw error
  }

  const invoice = await issueFeeInvoice(id, bookingNo, fee)
  return { bookingNo, token, expiresAt, startsAt, endsAt, service: service.name, bookingFee: fee, invoice }
}

const notAvailable = () => conflict('NOT_AVAILABLE', 'That time is not open for booking')
const holdExists = () => conflict('HOLD_EXISTS', 'You already have a booking waiting for payment')

/** A window the barber opened that holds the whole appointment. */
function windowCovers(startsAt: Date, endsAt: Date) {
  return and(lte(availability.startsAt, startsAt), gte(availability.endsAt, endsAt))
}

/** One unpaid hold per customer at a time, so nobody can squat on times. */
function liveHoldOf(customer: { customerPhone: string; customerEmail: string }) {
  return and(
    eq(appointments.status, 'pending'),
    gt(appointments.expiresAt, new Date()),
    or(eq(appointments.customerPhone, customer.customerPhone), eq(appointments.customerEmail, customer.customerEmail)),
  )
}

/**
 * After the hold is written. If QPay won't issue, the hold is removed again.
 * If QPay issued but the invoice could not be saved, it is cancelled first:
 * a payable invoice with no hold behind it would take money for nothing.
 */
async function issueFeeInvoice(appointmentId: string, bookingNo: string, fee: number) {
  let invoice
  try {
    invoice = await getQpayProvider().createInvoice({
      orderNo: bookingNo,
      amount: fee,
      description: `Three33 ${bookingNo}`,
      callbackUrl: feeCallbackUrl(appointmentId),
    })
  } catch (error) {
    console.error(`QPay fee invoice failed for ${bookingNo}`, error)
    await releaseHold(appointmentId)
    throw qpayUnavailable()
  }

  const payload = { qrText: invoice.qrText, qrImage: invoice.qrImage, shortUrl: invoice.shortUrl, links: invoice.links }
  try {
    await db
      .update(appointments)
      .set({ qpayInvoiceId: invoice.invoiceId, invoicePayload: payload })
      .where(eq(appointments.id, appointmentId))
  } catch (error) {
    console.error(`Saving QPay fee invoice ${invoice.invoiceId} for ${bookingNo} failed`, error)
    try {
      await getQpayProvider().cancelInvoice(invoice.invoiceId)
    } catch (cancelError) {
      console.error(`Orphaned QPay fee invoice ${invoice.invoiceId} for ${bookingNo}`, cancelError)
    }
    await releaseHold(appointmentId)
    throw qpayUnavailable()
  }
  return payload
}

/** Only while still pending: a hold confirmed meanwhile is never removed. */
async function releaseHold(appointmentId: string): Promise<void> {
  await db.delete(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending')))
}

const qpayUnavailable = () => new ApiError(502, 'QPAY_UNAVAILABLE', 'Payment could not be started; please try again')

/** Signed per appointment, so the public callback can't be pointed at others. */
export const feeCallbackSubject = (appointmentId: string) => `booking-fee:${appointmentId}`

function feeCallbackUrl(appointmentId: string): string {
  const url = new URL('/api/v1/public/qpay/booking-fee', env.APP_URL)
  url.searchParams.set('appointment', appointmentId)
  url.searchParams.set('t', signCallbackToken(feeCallbackSubject(appointmentId), env.QPAY_CALLBACK_SECRET))
  return url.toString()
}
