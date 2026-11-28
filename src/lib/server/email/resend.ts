import { env } from '../env'

/**
 * An image carried in the message body rather than fetched from a URL. The
 * html refers to it as `src="cid:<cid>"`. See email/logo.ts for why the
 * wordmark travels this way.
 */
export interface InlineImage {
  cid: string
  name: string
  mimeType: string
  base64: string
}

export interface EmailMessage {
  to: { email: string; name?: string }
  subject: string
  html: string
  text: string
  inlineImages?: InlineImage[]
}

/**
 * How long a send may take before it is abandoned. Resend answers in well
 * under a second; without a bound a hung connection would hold the request
 * (or the background task) open until the Worker itself is killed.
 */
const SEND_TIMEOUT_MS = 10_000

/** Characters of Resend's error body kept in the thrown message. */
const ERROR_BODY_LENGTH_MAX = 300

/** Resend takes a single "Name <email>" string for each recipient, the same
 * shape EMAIL_FROM already uses. */
function formatAddress(email: string, name?: string): string {
  if (!name) return email
  // Quoted so a comma or angle bracket in a customer's name can't split or
  // corrupt the address.
  return `"${name.replace(/["\\]/g, '')}" <${email}>`
}

/**
 * Sends one transactional email via Resend's HTTP API.
 *
 * Returns false rather than throwing when RESEND_API_KEY is unset — every
 * caller of this is a best-effort side effect (a receipt after payment, not
 * the payment itself) and must never turn a missing mail setup into a failed
 * settlement. A configured key that then fails at Resend's end still throws,
 * because that failure is worth a caller logging.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [formatAddress(message.to.email, message.to.name)],
      subject: message.subject,
      html: message.html,
      text: message.text,
      // Inline rather than attached: content_id is what makes a client render
      // the image where `cid:` points instead of listing it as a download.
      ...(message.inlineImages?.length
        ? {
            attachments: message.inlineImages.map((image) => ({
              content: image.base64,
              filename: image.name,
              content_type: image.mimeType,
              content_id: image.cid,
            })),
          }
        : {}),
    }),
  })

  if (!response.ok) {
    // The status is the error; the body only adds detail, so a body that
    // cannot be read is noted in the message rather than replacing it.
    const body = await response.text().catch((error: unknown) => `(body unreadable: ${String(error)})`)
    throw new Error(
      `Resend send failed (${response.status}): ${body.slice(0, ERROR_BODY_LENGTH_MAX)}`,
    )
  }

  return true
}
