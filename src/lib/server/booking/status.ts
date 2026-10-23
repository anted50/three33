import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { appointments } from '~/db/schema'
import { ApiError } from '../api/errors'
import { safeCompare } from '../auth/session'

/**
 * The customer's view of their booking, reached with the private token they
 * got when booking. A wrong token and a hold that was deleted (never paid)
 * look the same from outside — "not booked" — so the endpoint can't be used
 * to probe booking numbers.
 */

const notBooked = () => new ApiError(404, 'NOT_BOOKED', 'This time was not booked')

const STATE = { pending: 'holding', booked: 'confirmed', cancelled: 'cancelled' } as const

export async function findByToken(bookingNo: string, token: string) {
  const [row] = await db.select().from(appointments).where(eq(appointments.bookingNo, bookingNo)).limit(1)
  const hash = createHash('sha256').update(token).digest('hex')
  if (!row || !safeCompare(hash, row.accessTokenHash)) throw notBooked()
  return row
}

export async function bookingStatus(bookingNo: string, token: string) {
  const a = await findByToken(bookingNo, token)
  const state = STATE[a.status]
  return {
    bookingNo: a.bookingNo,
    state,
    service: a.serviceName,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    customerName: a.customerName,
    bookingFee: a.bookingFee,
    feePaid: a.paidAt !== null,
    ...(state === 'holding' ? { expiresAt: a.expiresAt, invoice: a.invoicePayload } : {}),
  }
}
