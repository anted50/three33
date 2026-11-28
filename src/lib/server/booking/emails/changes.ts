import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { appointments } from '~/db/schema'
import { localSpan, localStamp, sendBookingEmail } from './layout'

/**
 * Telling the customer an admin changed their booking. Sent automatically
 * after a reschedule or a cancellation (appointments.ts) — in the
 * background, so a mail problem never undoes or fails the change itself.
 * Bookings without an email (an admin-entered phone booking) get nothing.
 */

export type ChangeOutcome = 'sent' | 'mail_disabled' | 'no_email' | 'not_found'

/** "Your booking moved", with the old and the new time. */
export async function sendRescheduled(appointmentId: string, previous: { startsAt: Date }): Promise<ChangeOutcome> {
  const [appointment] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
  if (!appointment) return 'not_found'
  if (!appointment.customerEmail) return 'no_email'
  const when = localStamp(appointment.startsAt)
  const sent = await sendBookingEmail({
    to: { email: appointment.customerEmail, name: appointment.customerName },
    subject: `Таны цаг өөрчлөгдлөө — ${when}`,
    heading: 'Таны захиалсан цаг өөрчлөгдлөө',
    headline: when,
    rows: [
      ['Захиалгын дугаар', appointment.bookingNo],
      ['Үйлчилгээ', appointment.serviceName],
      ['Шинэ цаг', localSpan(appointment.startsAt, appointment.endsAt)],
      ['Өмнөх цаг', localStamp(previous.startsAt)],
    ],
    footnote: 'Шинэ цаг тохирохгүй бол бидэнтэй холбогдоно уу.',
  })
  return sent ? 'sent' : 'mail_disabled'
}

/** "Your booking was cancelled". */
export async function sendCancelled(appointmentId: string): Promise<ChangeOutcome> {
  const [appointment] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
  if (!appointment) return 'not_found'
  if (!appointment.customerEmail) return 'no_email'
  const when = localStamp(appointment.startsAt)
  const sent = await sendBookingEmail({
    to: { email: appointment.customerEmail, name: appointment.customerName },
    subject: `Таны цаг цуцлагдлаа — ${when}`,
    heading: 'Таны захиалсан цаг цуцлагдлаа',
    headline: when,
    rows: [
      ['Захиалгын дугаар', appointment.bookingNo],
      ['Үйлчилгээ', appointment.serviceName],
      ['Цаг', localSpan(appointment.startsAt, appointment.endsAt)],
    ],
    footnote: 'Асуух зүйл байвал бидэнтэй холбогдоно уу.',
  })
  return sent ? 'sent' : 'mail_disabled'
}
