import { LOGO_PNG_BASE64 } from './logo-data'

/**
 * The wordmark at the top of every transactional email, embedded in the
 * message rather than linked from the site.
 *
 * It used to be `<img src="${env.APP_URL}/email-logo.png">`, and in production
 * it did not appear. A remote image in an email has to survive three separate
 * things going right — APP_URL has to be the address the customer's mail
 * client can actually reach (not an internal or preview host), the file has to
 * be served there, and the client has to be willing to fetch remote images at
 * all, which Outlook and many corporate clients are not by default. An inline
 * attachment referenced by cid: needs none of them: the bytes travel with the
 * message.
 *
 * Kept as a PNG generated once by scripts/generate-email-logo.mjs — see that
 * file for why this is not inline SVG. The generator also writes the bytes
 * into logo-data.ts, which is what gets attached: a Worker has no filesystem,
 * so reading public/email-logo.png at send time is not an option.
 */
export const LOGO_CID = 'three33-logo'

/** Inline attachment for Resend; the bytes are bundled, see logo-data.ts. */
export function logoAttachment(): {
  cid: string
  name: string
  mimeType: string
  base64: string
} {
  return {
    cid: LOGO_CID,
    name: 'email-logo.png',
    mimeType: 'image/png',
    base64: LOGO_PNG_BASE64,
  }
}

/**
 * width/height as attributes as well as in the style, because Outlook sizes
 * images from the attributes and ignores the CSS — without them the mark
 * renders at its intrinsic 1000-odd pixels wide and blows the layout open.
 */
export function logoImgTag(): string {
  return `<img src="cid:${LOGO_CID}" alt="Three33 Barbershop" width="200" height="28" style="display:inline-block;width:200px;height:28px;border:0;outline:none;text-decoration:none" />`
}
