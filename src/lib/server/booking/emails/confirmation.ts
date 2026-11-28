import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { type Appointment, appointments } from '~/db/schema'
import { assert } from '~/lib/assert'
import { formatMnt } from '~/lib/money'
import { localSpan, localStamp, sendBookingEmail } from './layout'

/**
 * The booking confirmation. Sent once when a booking is confirmed — its fee
 * paid online, or an admin entering it — never for a hold, and again only
 * when an admin resends it. `confirmation_sent_at` is claimed before
 * sending, so a QPay callback and a poll confirming the same booking can't
 * both send it; a failed send releases the claim so a retry can.
 */

export type ConfirmationOutcome = 'sent' | 'already_sent' | 'mail_disabled' | 'not_confirmed' | 'no_email'

/**
 * `force` (an admin resending) skips the claim, and so must never release
 * one: a failed resend leaves the first send's stamp in place.
 */
export async function sendConfirmation(appointmentId: string, options: { force?: boolean } = {}): Promise<ConfirmationOutcome> {
  const force = options.force === true
  const [appointment] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
  if (!appointment) return 'not_confirmed'
  if (appointment.status !== 'booked') return 'not_confirmed'
  if (!appointment.customerEmail) return 'no_email'

  if (!force) {
    const claimed = await claimConfirmation(appointmentId)
    if (!claimed) return 'already_sent'
  }

  let sent: boolean
  try {
    sent = await sendBookingEmail(confirmationEmail(appointment, appointment.customerEmail))
  } catch (error) {
    if (!force) await releaseConfirmation(appointmentId)
    throw error
  }

  if (!sent) {
    if (!force) await releaseConfirmation(appointmentId)
    return 'mail_disabled'
  }
  if (force) await db.update(appointments).set({ confirmationSentAt: new Date() }).where(eq(appointments.id, appointmentId))
  return 'sent'
}

/** Stamps confirmation_sent_at unless it is set; true when this call stamped it. */
async function claimConfirmation(appointmentId: string): Promise<boolean> {
  const claimed = await db
    .update(appointments)
    .set({ confirmationSentAt: new Date() })
    .where(and(eq(appointments.id, appointmentId), isNull(appointments.confirmationSentAt)))
    .returning({ id: appointments.id })
  assert(claimed.length <= 1, 'an appointment id matches one row')
  return claimed.length === 1
}

/** Gives the claim back after a failed send, so a retry can send. */
async function releaseConfirmation(appointmentId: string): Promise<void> {
  await db.update(appointments).set({ confirmationSentAt: null }).where(eq(appointments.id, appointmentId))
}

export function confirmationEmail(appointment: Appointment, email: string) {
  const when = localStamp(appointment.startsAt)
  const rows: Array<[string, string]> = [
    ['Захиалгын дугаар', appointment.bookingNo],
    ['Үйлчилгээ', appointment.serviceName],
    ['Цаг', localSpan(appointment.startsAt, appointment.endsAt)],
  ]
  // An admin-entered booking has no fee, so there is nothing paid to show.
  if (appointment.bookingFee > 0) rows.push(['Урьдчилгаа төлсөн', formatMnt(appointment.bookingFee)])
  return {
    to: { email, name: appointment.customerName },
    subject: `Цаг баталгаажлаа — ${when}`,
    heading: 'Цаг захиалга баталгаажлаа',
    headline: when,
    rows,
    footnote: 'Цагаа өөрчлөх эсвэл цуцлах бол бидэнтэй холбогдоно уу.',
  }
}
