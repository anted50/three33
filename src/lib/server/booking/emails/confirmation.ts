import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { appointmentServices, appointments, barbers, locations } from '~/db/schema'
import { formatMnt } from '~/lib/money'
import { logoAttachment, logoImgTag } from '../../email/logo'
import { emailDocument, INK, INK_FAINT, INK_SOFT, PANEL, PAPER, RULE } from '../../email/shell'
import { sendEmail } from '../../email/resend'

/**
 * The booking confirmation. Sent exactly once, and only when a booking is
 * confirmed — its fee paid online, or the barber entering it. Never for a
 * hold. `confirmation_sent_at` is claimed before sending, so a QPay callback
 * and a poll confirming the same booking can't both send it; a failed send
 * releases the claim so the resend button (or the next attempt) can retry.
 *
 * Contacting the barber is the customer's only way to change the booking,
 * so their phone is the most prominent thing after the time.
 */

export type ConfirmationOutcome = 'sent' | 'no_email' | 'already_sent' | 'mail_disabled' | 'not_confirmed'

export async function sendConfirmation(appointmentId: string, opts: { force?: boolean } = {}): Promise<ConfirmationOutcome> {
  const data = await load(appointmentId)
  if (!data) return 'not_confirmed'
  if (!data.appointment.customerEmail) return 'no_email'

  if (!opts.force) {
    const claimed = await db
      .update(appointments)
      .set({ confirmationSentAt: new Date() })
      .where(and(eq(appointments.id, appointmentId), isNull(appointments.confirmationSentAt)))
      .returning({ id: appointments.id })
    if (claimed.length === 0) return 'already_sent'
  }

  try {
    const { subject, html, text } = render(data)
    const logo = logoAttachment()
    const sent = await sendEmail({
      to: { email: data.appointment.customerEmail, name: data.appointment.customerName },
      subject,
      html,
      text,
      inlineImages: logo ? [logo] : undefined,
    })
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

/** Fire-and-forget after a confirming transaction: the booking is already
 * real, and a mail hiccup must not turn into an error for the caller. */
export function sendConfirmationInBackground(appointmentId: string) {
  void sendConfirmation(appointmentId).catch((error) => {
    console.error(`confirmation email failed for appointment ${appointmentId}`, error)
  })
}

async function release(appointmentId: string) {
  await db.update(appointments).set({ confirmationSentAt: null }).where(eq(appointments.id, appointmentId))
}

async function load(appointmentId: string) {
  const [row] = await db
    .select({ appointment: appointments, barber: { name: barbers.name, phone: barbers.phone }, location: locations })
    .from(appointments)
    .innerJoin(barbers, eq(barbers.id, appointments.barberId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(eq(appointments.id, appointmentId))
    .limit(1)
  if (!row || !['booked', 'completed'].includes(row.appointment.status)) return null
  const lines = await db
    .select({ name: appointmentServices.nameSnapshot, price: appointmentServices.priceSnapshot })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appointmentId))
    .orderBy(appointmentServices.sortOrder)
  return { ...row, lines }
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>

/** 2026.10.05 11:00 — Ulaanbaatar time. */
function localStamp(instant: Date): string {
  const d = new Date(instant.getTime() + 8 * 3600e3).toISOString()
  return `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)} ${d.slice(11, 16)}`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MAX_WIDTH = 460

function render({ appointment: a, barber, location, lines }: Loaded) {
  const when = localStamp(a.startsAt)
  const due = a.total - a.bookingFee
  const rows: Array<[string, string]> = [
    ['Захиалгын дугаар', a.bookingNo],
    ['Цаг', `${when} – ${localStamp(a.endsAt).slice(11)}`],
    ['Салбар', `${location.nameMn}, ${location.address}`],
    ['Үсчин', `${barber.name} · ${barber.phone}`],
    ...lines.map((l): [string, string] => [l.name, formatMnt(l.price)]),
    ['Нийт', formatMnt(a.total)],
    ...(a.bookingFee > 0 ? ([['Урьдчилгаа төлсөн', formatMnt(a.bookingFee)]] as Array<[string, string]>) : []),
    ['Салбар дээр төлөх', formatMnt(due)],
  ]
  const changeNote = `Цагаа өөрчлөх эсвэл цуцлах бол үсчин ${barber.name}-тай ${barber.phone} дугаараар холбогдоно уу.`

  const text = [
    'Цаг захиалга баталгаажлаа',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(location.mapLink ? ['', `Байршил: ${location.mapLink}`] : []),
    '',
    changeNote,
  ].join('\n')

  const tableRows = rows
    .map(
      ([k, v]) => `
        <tr>
          <td class="soft" style="padding:8px 0;border-bottom:1px solid ${RULE};font-size:13px;color:${INK_SOFT}">${escapeHtml(k)}</td>
          <td class="keepink" style="padding:8px 0;border-bottom:1px solid ${RULE};font-size:13px;color:${INK};text-align:right">${escapeHtml(v)}</td>
        </tr>`,
    )
    .join('')

  const body = `
    <div class="lightbg" bgcolor="${PAPER}" style="background-color:${PAPER};font-family:${SANS};color:${INK};width:100%">
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:36px 24px 0;text-align:center">${logoImgTag()}</div>
      <div class="panel" bgcolor="${PANEL}" style="max-width:${MAX_WIDTH}px;margin:28px auto 0;background-color:${PANEL};padding:28px 24px">
        <p class="keepink" style="margin:0 0 6px;font-size:14px;color:${INK};text-align:center">Цаг захиалга баталгаажлаа</p>
        <p class="keepink" style="margin:0 0 20px;font-size:26px;font-weight:800;color:${INK};text-align:center">${escapeHtml(when)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${tableRows}</table>
        ${location.mapLink ? `<p style="margin:18px 0 0;font-size:13px;text-align:center"><a href="${escapeHtml(location.mapLink)}" style="color:${INK}">Байршил харах</a></p>` : ''}
      </div>
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:20px 24px 36px;text-align:center">
        <p class="faint" style="margin:0;font-size:12px;color:${INK_FAINT}">${escapeHtml(changeNote)}</p>
      </div>
    </div>`

  return {
    subject: `Цаг баталгаажлаа — ${when}`,
    html: emailDocument({ title: 'Цаг захиалга баталгаажлаа', preheader: `${location.nameMn} · ${barber.name}`, body }),
    text,
  }
}
