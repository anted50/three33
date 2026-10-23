import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { type Appointment, appointments } from '~/db/schema'
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

export async function sendConfirmation(appointmentId: string, opts: { force?: boolean } = {}): Promise<ConfirmationOutcome> {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
  if (!a || a.status !== 'booked') return 'not_confirmed'
  if (!a.customerEmail) return 'no_email'

  if (!opts.force) {
    const claimed = await db
      .update(appointments)
      .set({ confirmationSentAt: new Date() })
      .where(and(eq(appointments.id, appointmentId), isNull(appointments.confirmationSentAt)))
      .returning({ id: appointments.id })
    if (claimed.length === 0) return 'already_sent'
  }

  try {
    const sent = await sendBookingEmail(confirmationEmail(a, a.customerEmail))
    if (!sent) {
      await release(appointmentId)
      return 'mail_disabled'
    }
    if (opts.force) await db.update(appointments).set({ confirmationSentAt: new Date() }).where(eq(appointments.id, appointmentId))
    return 'sent'
  } catch (error) {
    await release(appointmentId)
    throw error
  }
}

async function release(appointmentId: string) {
  await db.update(appointments).set({ confirmationSentAt: null }).where(eq(appointments.id, appointmentId))
}

export function confirmationEmail(a: Appointment, email: string) {
  const when = localStamp(a.startsAt)
  return {
    to: { email, name: a.customerName },
    subject: `Цаг баталгаажлаа — ${when}`,
    heading: 'Цаг захиалга баталгаажлаа',
    headline: when,
    rows: [
      ['Захиалгын дугаар', a.bookingNo],
      ['Үйлчилгээ', a.serviceName],
      ['Цаг', localSpan(a.startsAt, a.endsAt)],
      ...(a.bookingFee > 0 ? ([['Урьдчилгаа төлсөн', formatMnt(a.bookingFee)]] as Array<[string, string]>) : []),
    ] as Array<[string, string]>,
    footnote: 'Цагаа өөрчлөх эсвэл цуцлах бол бидэнтэй холбогдоно уу.',
  }
}
