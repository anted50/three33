import { sendEmail } from '../email/zeptomail'
import { env } from '../env'
import { OTP_TTL_MS } from './otp'

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Same monochrome language as the order receipt — see orders/receipt.ts. */
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

  const html = `
    <div style="background:#ffffff;font-family:${SANS};color:#0a0a0a">
      <div style="max-width:420px;margin:0 auto;padding:36px 24px 0;text-align:center">
        <img src="${env.APP_URL}/email-logo.png" alt="Three33 Barbershop" width="200" height="28" style="display:inline-block;width:200px;height:28px" />
      </div>
      <div style="max-width:420px;margin:28px auto 0;background:#f4f4f2;padding:32px 24px;text-align:center">
        <p style="margin:0 0 18px;font-size:14px">Админ нэвтрэх код</p>
        <p style="margin:0;font-size:38px;font-weight:800;letter-spacing:0.18em;font-variant-numeric:tabular-nums">${code}</p>
        <p style="margin:18px 0 0;font-size:12.5px;color:#5c5c58">${minutes} минутын дараа хүчингүй болно</p>
      </div>
      <div style="max-width:420px;margin:0 auto;padding:20px 24px 36px;text-align:center">
        <p style="margin:0;font-size:12px;color:#8a8a86">Хэрэв та нэвтрэх гэж оролдоогүй бол энэ имэйлийг үл тоомсорлож болно.</p>
      </div>
    </div>
  `

  await sendEmail({
    to: { email },
    subject: `${code} — админ нэвтрэх код`,
    html,
    text,
  })
}
