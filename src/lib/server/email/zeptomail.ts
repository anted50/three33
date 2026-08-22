import { env } from '../env'

export interface EmailMessage {
  to: { email: string; name?: string }
  subject: string
  html: string
  text: string
}

/** EMAIL_FROM is "Name <email>" everywhere else in this codebase; parsed once
 * here rather than adding a second, differently-shaped sender env var. */
function parseSender(value: string): { name?: string; address: string } {
  const match = value.match(/^(.*)<(.+)>$/)
  if (match) {
    const name = match[1]?.trim()
    const address = match[2]?.trim()
    if (address) return { name: name || undefined, address }
  }
  return { address: value.trim() }
}

/**
 * Sends one transactional email via ZeptoMail's HTTP API.
 *
 * Returns false rather than throwing when MAIL_API_TOKEN is unset — every
 * caller of this is a best-effort side effect (a receipt after payment, not
 * the payment itself) and must never turn a missing mail setup into a failed
 * settlement. A configured key that then fails at ZeptoMail's end still
 * throws, because that failure is worth a caller logging.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!env.MAIL_API_TOKEN) return false

  const response = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      // MAIL_API_TOKEN is the complete header value ("Zoho-enczapikey <token>"),
      // not a bare token — see env.ts.
      Authorization: env.MAIL_API_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: parseSender(env.EMAIL_FROM),
      to: [
        {
          email_address: {
            address: message.to.email,
            name: message.to.name,
          },
        },
      ],
      subject: message.subject,
      htmlbody: message.html,
      textbody: message.text,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `ZeptoMail send failed (${response.status}): ${body.slice(0, 300)}`,
    )
  }

  return true
}
