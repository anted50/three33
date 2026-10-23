import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, gte, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { atomic } from '~/db/atomic'
import { appointments, availability } from '~/db/schema'
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

  const service = await bookableService(input.serviceId)
  const startsAt = new Date(input.startsAt)
  const endsAt = addMinutes(startsAt, service.durationMinutes)
  if (startsAt <= new Date()) throw badRequest('That time has passed')

  await assertInsideWindow(startsAt, endsAt)
  await assertNoLiveHold(input.customerPhone, input.customerEmail)

  const token = randomBytes(24).toString('base64url')
  const id = crypto.randomUUID()
  const bookingNo = generateBookingNo()
  const expiresAt = new Date(Date.now() + HOLD_MS)

  // A clash with another booking or hold aborts here with TIME_TAKEN
  // (the no-overlap trigger, mapped in api/db-errors.ts).
  await atomic([
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

  const invoice = await issueFeeInvoice(id, bookingNo, fee)
  return { bookingNo, token, expiresAt, startsAt, endsAt, service: service.name, bookingFee: fee, invoice }
}

async function assertInsideWindow(startsAt: Date, endsAt: Date) {
  const [window] = await db
    .select({ id: availability.id })
    .from(availability)
    .where(and(lte(availability.startsAt, startsAt), gte(availability.endsAt, endsAt)))
    .limit(1)
  if (!window) throw conflict('NOT_AVAILABLE', 'That time is not open for booking')
}

/** One unpaid hold per customer at a time, so nobody can squat on times. */
async function assertNoLiveHold(customerPhone: string, customerEmail: string) {
  const [live] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, 'pending'),
        gt(appointments.expiresAt, new Date()),
        or(eq(appointments.customerPhone, customerPhone), eq(appointments.customerEmail, customerEmail)),
      ),
    )
    .limit(1)
  if (live) throw conflict('HOLD_EXISTS', 'You already have a booking waiting for payment')
}

/** After the hold is written; if QPay won't issue, the hold is removed again. */
async function issueFeeInvoice(appointmentId: string, bookingNo: string, fee: number) {
  try {
    const invoice = await getQpayProvider().createInvoice({
      orderNo: bookingNo,
      amount: fee,
      description: `Three33 ${bookingNo}`,
      callbackUrl: feeCallbackUrl(appointmentId),
    })
    const payload = { qrText: invoice.qrText, qrImage: invoice.qrImage, shortUrl: invoice.shortUrl, links: invoice.links }
    await db
      .update(appointments)
      .set({ qpayInvoiceId: invoice.invoiceId, invoicePayload: payload })
      .where(eq(appointments.id, appointmentId))
    return payload
  } catch (error) {
    console.error(`QPay fee invoice failed for ${bookingNo}`, error)
    await db.delete(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending')))
    throw new ApiError(502, 'QPAY_UNAVAILABLE', 'Payment could not be started; please try again')
  }
}

/** Signed per appointment, so the public callback can't be pointed at others. */
export const feeCallbackSubject = (appointmentId: string) => `booking-fee:${appointmentId}`

function feeCallbackUrl(appointmentId: string): string {
  const url = new URL('/api/v1/public/qpay/booking-fee', env.APP_URL)
  url.searchParams.set('appointment', appointmentId)
  url.searchParams.set('t', signCallbackToken(feeCallbackSubject(appointmentId), env.QPAY_CALLBACK_SECRET))
  return url.toString()
}
