import { logoAttachment, logoImgTag } from '../email/logo'
import {
  emailDocument,
  INK,
  INK_FAINT,
  INK_SOFT,
  PANEL,
  PAPER,
} from '../email/shell'
import { sendEmail } from '../email/zeptomail'
import { OTP_TTL_MS } from './otp'

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

const MAX_WIDTH = 420

/** Same monochrome language as the order receipt — see orders/receipt.ts, and
 * email/shell.ts for the document both are wrapped in and why. */
export async function sendAdminOtpEmail(
  email: string,
  code: string,
): Promise<void> {
  const minutes = Math.round(OTP_TTL_MS / 60_000)

  const text = [
    'Админ нэвтрэх код',
    '',
    code,
    '',
    `Энэ код ${minutes} минутын дараа хүчингүй болно.`,
    'Хэрэв та нэвтрэх гэж оролдоогүй бол энэ имэйлийг үл тоомсорлож болно.',
  ].join('\n')

  const body = `
    <div class="lightbg" bgcolor="${PAPER}" style="background-color:${PAPER};font-family:${SANS};color:${INK};width:100%">
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:36px 24px 0;text-align:center">
        ${logoImgTag()}
      </div>
      <div class="panel" bgcolor="${PANEL}" style="max-width:${MAX_WIDTH}px;margin:28px auto 0;background-color:${PANEL};padding:32px 24px;text-align:center">
        <p class="keepink" style="margin:0 0 18px;font-size:14px;color:${INK}">Админ нэвтрэх код</p>
        <p class="keepink" style="margin:0;font-size:38px;font-weight:800;letter-spacing:0.18em;font-variant-numeric:tabular-nums;color:${INK}">${code}</p>
        <p class="soft" style="margin:18px 0 0;font-size:12.5px;color:${INK_SOFT}">${minutes} минутын дараа хүчингүй болно</p>
      </div>
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:20px 24px 36px;text-align:center">
        <p class="faint" style="margin:0;font-size:12px;color:${INK_FAINT}">Хэрэв та нэвтрэх гэж оролдоогүй бол энэ имэйлийг үл тоомсорлож болно.</p>
      </div>
    </div>
  `

  const logo = logoAttachment()

  await sendEmail({
    to: { email },
    subject: `${code} — админ нэвтрэх код`,
    html: emailDocument({
      title: 'Админ нэвтрэх код',
      // The code is already in the subject; repeating it in the preview line
      // puts it twice in the inbox list and nowhere useful.
      preheader: `${minutes} минутын дараа хүчингүй болно.`,
      body,
    }),
    text,
    inlineImages: logo ? [logo] : undefined,
  })
}
