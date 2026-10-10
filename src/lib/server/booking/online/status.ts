import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/db'
import { appointmentPayments, appointmentServices, appointments, barbers, locations } from '~/db/schema'
import { ApiError } from '../../api/errors'
import { safeCompare } from '../../auth/session'

/**
 * The customer's view of their booking, reached with the private token they
 * got when booking. A wrong token and a hold that was deleted (never paid)
 * look the same from outside — "not booked" — so the endpoint can't be used
 * to probe booking numbers.
 */

const notBooked = () => new ApiError(404, 'NOT_BOOKED', 'This time was not booked')

const STATE = {
  pending: 'holding',
  booked: 'confirmed',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show',
} as const

export async function findByToken(bookingNo: string, token: string) {
  const [row] = await db
    .select({ appointment: appointments, barber: { name: barbers.name, phone: barbers.phone }, location: locations })
    .from(appointments)
    .innerJoin(barbers, eq(barbers.id, appointments.barberId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(eq(appointments.bookingNo, bookingNo))
    .limit(1)
  const hash = createHash('sha256').update(token).digest('hex')
  if (!row || !safeCompare(hash, row.appointment.accessTokenHash)) throw notBooked()
  return row
}

export async function bookingStatus(bookingNo: string, token: string) {
  const { appointment: a, barber, location } = await findByToken(bookingNo, token)

  const lines = await db
    .select({ name: appointmentServices.nameSnapshot, price: appointmentServices.priceSnapshot, durationMinutes: appointmentServices.durationMinutesSnapshot })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, a.id))
    .orderBy(appointmentServices.sortOrder)

  const [fee] = await db
    .select({ id: appointmentPayments.id, status: appointmentPayments.status, invoicePayload: appointmentPayments.invoicePayload })
    .from(appointmentPayments)
    .where(and(eq(appointmentPayments.appointmentId, a.id), eq(appointmentPayments.kind, 'booking_fee')))
    .limit(1)

  const state = STATE[a.status]
  return {
    bookingNo: a.bookingNo,
    state,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    location: { nameMn: location.nameMn, nameEn: location.nameEn, address: location.address, mapLink: location.mapLink },
    /** Calling the barber is how a customer changes or cancels. */
    barber,
    services: lines,
    total: a.total,
    bookingFee: a.bookingFee,
    dueAtShop: a.total - a.bookingFee,
    feePaid: fee?.status === 'paid',
    ...(state === 'holding' ? { expiresAt: a.expiresAt, invoice: fee?.invoicePayload ?? null } : {}),
  }
}

/** The pending fee payment behind a hold, for the customer's poll. */
export async function feePaymentIdFor(bookingNo: string, token: string) {
  const { appointment } = await findByToken(bookingNo, token)
  const [fee] = await db
    .select({ id: appointmentPayments.id })
    .from(appointmentPayments)
    .where(and(eq(appointmentPayments.appointmentId, appointment.id), eq(appointmentPayments.kind, 'booking_fee')))
    .limit(1)
  if (!fee) throw notBooked()
  return fee.id
}
