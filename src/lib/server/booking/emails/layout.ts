import { logoAttachment, logoImgTag } from '../../email/logo'
import { sendEmail } from '../../email/resend'
import { emailDocument, INK, INK_FAINT, INK_SOFT, PANEL, PAPER, RULE } from '../../email/shell'

/**
 * The one layout every booking email uses — confirmation, moved, cancelled:
 * logo, a heading, the time in large type, a table of details, a footnote.
 * Monochrome and light-only, like the order receipt (see email/shell.ts).
 */

export interface BookingEmail {
  to: { email: string; name: string }
  subject: string
  heading: string
  /** The big line under the heading — normally the local time. */
  headline: string
  rows: Array<[string, string]>
  footnote: string
}

/** Ulaanbaatar is UTC+8 all year; see booking/time.ts. */
const UB_OFFSET_MS = 8 * 60 * 60 * 1000

/** 2026.10.05 11:00 — Ulaanbaatar time. */
export function localStamp(instant: Date): string {
  const local = new Date(instant.getTime() + UB_OFFSET_MS).toISOString()
  return `${local.slice(0, 4)}.${local.slice(5, 7)}.${local.slice(8, 10)} ${local.slice(11, 16)}`
}

/** 11:00 – 11:45, the local time span of a booking. */
export function localSpan(startsAt: Date, endsAt: Date): string {
  return `${localStamp(startsAt)} – ${localStamp(endsAt).slice(11)}`
}

/** Sends it. False when mail is not configured (RESEND_API_KEY unset). */
export async function sendBookingEmail(email: BookingEmail): Promise<boolean> {
  const { html, text } = render(email)
  return sendEmail({ to: email.to, subject: email.subject, html, text, inlineImages: [logoAttachment()] })
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MAX_WIDTH = 460

export function render({ heading, headline, rows, footnote }: BookingEmail) {
  const text = [heading, '', headline, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', footnote].join('\n')

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td class="soft" style="padding:8px 0;border-bottom:1px solid ${RULE};font-size:13px;color:${INK_SOFT}">${escapeHtml(label)}</td>
          <td class="keepink" style="padding:8px 0;border-bottom:1px solid ${RULE};font-size:13px;color:${INK};text-align:right">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('')

  const body = `
    <div class="lightbg" bgcolor="${PAPER}" style="background-color:${PAPER};font-family:${SANS};color:${INK};width:100%">
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:36px 24px 0;text-align:center">${logoImgTag()}</div>
      <div class="panel" bgcolor="${PANEL}" style="max-width:${MAX_WIDTH}px;margin:28px auto 0;background-color:${PANEL};padding:28px 24px">
        <p class="keepink" style="margin:0 0 6px;font-size:14px;color:${INK};text-align:center">${escapeHtml(heading)}</p>
        <p class="keepink" style="margin:0 0 20px;font-size:26px;font-weight:800;color:${INK};text-align:center">${escapeHtml(headline)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${tableRows}</table>
      </div>
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:20px 24px 36px;text-align:center">
        <p class="faint" style="margin:0;font-size:12px;color:${INK_FAINT}">${escapeHtml(footnote)}</p>
      </div>
    </div>`

  return { html: emailDocument({ title: heading, preheader: headline, body }), text }
}
