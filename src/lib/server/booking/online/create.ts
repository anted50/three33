import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, gte, inArray, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentPayments, appointmentServices, appointments, barberLocations, barberShifts, barbers, services } from '~/db/schema'
import { ApiError, badRequest, conflict, notFound } from '../../api/errors'
import { email, phone } from '../../api/input'
import { env } from '../../env'
import { signCallbackToken } from '../../payments/callback-token'
import { getQpayProvider } from '../../payments/qpay'
import { generateRef } from '../refs'
import { addMinutes } from '../time'

/**
 * A customer booking online. Nothing a customer submits is kept unless money
 * arrives, so this writes only a short-lived HOLD — the appointment as
 * `pending`, its lines, and a pending fee payment — and asks QPay for the
 * fee invoice. The hold exists so two customers can't pay for the same slot
 * (appointments_no_overlap counts pending rows). If the fee isn't paid before
 * expires_at, the sweep deletes the hold entirely (sweep.ts). The booking is
 * confirmed — and only then emailed — when QPay says the fee is paid
 * (settle.ts).
 *
 * Online booking is only offered inside the barber's shifts, and only for
 * barbers with a booking fee: a fee of 0 means "call to book".
 */

/** How long the customer has to pay the fee. Matches the QR's useful life. */
export const HOLD_MS = 15 * 60 * 1000

export const onlineBookingInput = z.object({
  barberId: z.uuid(),
  locationId: z.uuid(),
  serviceIds: z.array(z.uuid()).min(1).max(10),
  startsAt: z.iso.datetime({ offset: true }),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: phone,
  /** Required online: it's where the confirmation goes. */
  customerEmail: email,
  note: z.string().trim().max(500).nullish(),
})

export async function createOnlineBooking(input: z.infer<typeof onlineBookingInput>) {
  const [barber] = await db
    .select({ id: barbers.id, bookingFee: barbers.bookingFee, bufferMinutes: barbers.bufferMinutes })
    .from(barbers)
    .innerJoin(barberLocations, eq(barberLocations.barberId, barbers.id))
    .where(and(eq(barbers.id, input.barberId), eq(barbers.isActive, true), eq(barberLocations.locationId, input.locationId)))
    .limit(1)
  if (!barber) throw notFound('Barber at this location')
  if (barber.bookingFee <= 0) throw conflict('ONLINE_BOOKING_OFF', 'This barber takes bookings by phone only')

  const picked = await db
    .select()
    .from(services)
    .where(
      and(
        inArray(services.id, input.serviceIds),
        eq(services.barberId, barber.id),
        eq(services.locationId, input.locationId),
        eq(services.isActive, true),
      ),
    )
  if (picked.length !== new Set(input.serviceIds).size) throw badRequest('Unknown service for this barber here')
  const ordered = input.serviceIds.map((id) => picked.find((s) => s.id === id)!)

  const startsAt = new Date(input.startsAt)
  const endsAt = addMinutes(startsAt, ordered.reduce((sum, s) => sum + s.durationMinutes, 0))
  const blockedUntil = addMinutes(endsAt, barber.bufferMinutes)
  const total = ordered.reduce((sum, s) => sum + s.price, 0)
  const fee = Math.min(barber.bookingFee, total)
  if (fee <= 0) throw badRequest('Free services cannot be booked online')

  if (startsAt <= new Date()) throw badRequest('That time has passed')
  await assertInsideShift(barber.id, input.locationId, startsAt, blockedUntil)
  await assertNoLiveHold(input.customerPhone, input.customerEmail)

  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + HOLD_MS)
  const bookingNo = generateRef('BK')

  const { appointmentId, paymentId } = await db.transaction(async (tx) => {
    const [appointment] = await tx
      .insert(appointments)
      .values({
        bookingNo,
        locationId: input.locationId,
        barberId: barber.id,
        source: 'online',
        status: 'pending',
        startsAt,
        endsAt,
        blockedUntil,
        bufferMinutes: barber.bufferMinutes,
        total,
        bookingFee: fee,
        expiresAt,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        note: input.note ?? null,
        accessTokenHash: createHash('sha256').update(token).digest('hex'),
      })
      .returning({ id: appointments.id })
    await tx.insert(appointmentServices).values(
      ordered.map((s, i) => ({
        appointmentId: appointment!.id,
        serviceId: s.id,
        nameSnapshot: s.nameEn,
        priceSnapshot: s.price,
        durationMinutesSnapshot: s.durationMinutes,
        sortOrder: i,
      })),
    )
    const [payment] = await tx
      .insert(appointmentPayments)
      .values({ appointmentId: appointment!.id, kind: 'booking_fee', method: 'qpay', amount: fee })
      .returning({ id: appointmentPayments.id })
    return { appointmentId: appointment!.id, paymentId: payment!.id }
  })

  const invoice = await issueFeeInvoice(appointmentId, paymentId, bookingNo, fee)
  return { bookingNo, token, expiresAt, total, bookingFee: fee, dueAtShop: total - fee, invoice }
}

async function assertInsideShift(barberId: string, locationId: string, startsAt: Date, blockedUntil: Date) {
  const [shift] = await db
    .select({ id: barberShifts.id })
    .from(barberShifts)
    .where(
      and(
        eq(barberShifts.barberId, barberId),
        eq(barberShifts.locationId, locationId),
        lte(barberShifts.startsAt, startsAt),
        gte(barberShifts.endsAt, blockedUntil),
      ),
    )
    .limit(1)
  if (!shift) throw conflict('NOT_AVAILABLE', 'That time is outside the barber’s schedule')
}

/** One unpaid hold per customer at a time, so nobody can squat on slots. */
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

/** Outside the transaction; if QPay won't issue, the hold is removed again. */
async function issueFeeInvoice(appointmentId: string, paymentId: string, bookingNo: string, fee: number) {
  try {
    const invoice = await getQpayProvider().createInvoice({
      orderNo: bookingNo,
      amount: fee,
      description: `Three33 ${bookingNo}`,
      callbackUrl: feeCallbackUrl(paymentId),
    })
    const payload = { qrText: invoice.qrText, qrImage: invoice.qrImage, shortUrl: invoice.shortUrl, links: invoice.links }
    await db
      .update(appointmentPayments)
      .set({ qpayInvoiceId: invoice.invoiceId, invoicePayload: payload })
      .where(eq(appointmentPayments.id, paymentId))
    return payload
  } catch (error) {
    console.error(`QPay fee invoice failed for ${bookingNo}`, error)
    await db.transaction(async (tx) => {
      await tx.delete(appointmentPayments).where(eq(appointmentPayments.id, paymentId))
      await tx.delete(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending')))
    })
    throw new ApiError(502, 'QPAY_UNAVAILABLE', 'Payment could not be started; please try again')
  }
}

export const feeCallbackSubject = (paymentId: string) => `booking-fee:${paymentId}`

function feeCallbackUrl(paymentId: string): string {
  const url = new URL('/api/v1/public/qpay/booking-fee', env.APP_URL)
  url.searchParams.set('payment', paymentId)
  url.searchParams.set('t', signCallbackToken(feeCallbackSubject(paymentId), env.QPAY_CALLBACK_SECRET))
  return url.toString()
}
