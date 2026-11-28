import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { type AppointmentStatus, appointments } from '~/db/schema'
import { assert } from '~/lib/assert'
import { ApiError } from '../api/errors'
import { safeCompare } from '../auth/session'

/**
 * The customer's view of their booking, reached with the private token they
 * got when booking. A wrong token and a hold that was deleted (never paid)
 * look the same from outside — "not booked" — so the endpoint can't be used
 * to probe booking numbers.
 */

const notBooked = () => new ApiError(404, 'NOT_BOOKED', 'This time was not booked')

/** Checked against the status enum at compile time, so a new status needs a state here. */
const STATE = { pending: 'holding', booked: 'confirmed', cancelled: 'cancelled' } as const satisfies Record<AppointmentStatus, string>

export async function findByToken(bookingNo: string, token: string) {
  assert(token.length > 0, 'findByToken: the route requires a token')
  const [row] = await db.select().from(appointments).where(eq(appointments.bookingNo, bookingNo)).limit(1)
  const hash = createHash('sha256').update(token).digest('hex')
  if (!row || !safeCompare(hash, row.accessTokenHash)) throw notBooked()
  assert(row.bookingNo === bookingNo, 'findByToken: the row is the booking asked for')
  return row
}

export async function bookingStatus(bookingNo: string, token: string) {
  const appointment = await findByToken(bookingNo, token)
  const state = STATE[appointment.status]
  return {
    bookingNo: appointment.bookingNo,
    state,
    service: appointment.serviceName,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    customerName: appointment.customerName,
    bookingFee: appointment.bookingFee,
    feePaid: appointment.paidAt !== null,
    ...(state === 'holding' ? { expiresAt: appointment.expiresAt, invoice: appointment.invoicePayload } : {}),
  }
}
