import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { env } from '../env'

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
 * file for why this is not inline SVG.
 */
export const LOGO_CID = 'three33-logo'

/**
 * Where the PNG is, in dev and in production respectively. Vite copies
 * public/ into dist/client at build time, and the production server runs from
 * the repo root, so one of these two resolves in either case. Checked in this
 * order because in a built checkout both exist and public/ is the source of
 * truth.
 */
const CANDIDATES = ['public/email-logo.png', 'dist/client/email-logo.png']

/**
 * Read once and held. The file is about 2KB and never changes at run time, so
 * re-reading it per send would be a syscall per email for nothing. `null`
 * means it could not be found, which is cached too — a missing file is not
 * going to appear later in the same process.
 */
let cached: string | null | undefined

function loadLogo(): string | null {
  if (cached !== undefined) return cached

  for (const candidate of CANDIDATES) {
    try {
      cached = readFileSync(resolve(process.cwd(), candidate)).toString('base64')
      return cached
    } catch {
      // Next candidate. A genuinely missing logo is handled below.
    }
  }

  console.warn(
    `email: ${CANDIDATES.join(' and ')} not found — falling back to a remote ` +
      'logo, which many clients will not display. Run ' +
      '`node scripts/generate-email-logo.mjs`.',
  )
  cached = null
  return cached
}

/**
 * The `inline_images` entry to hand ZeptoMail, or null when there is nothing
 * to attach — in which case logoImgTag falls back to the remote URL, so a
 * missing file costs the logo rather than the whole email.
 */
export function logoAttachment(): {
  cid: string
  name: string
  mimeType: string
  base64: string
} | null {
  const base64 = loadLogo()
  if (!base64) return null
  return {
    cid: LOGO_CID,
    name: 'email-logo.png',
    mimeType: 'image/png',
    base64,
  }
}

/**
 * width/height as attributes as well as in the style, because Outlook sizes
 * images from the attributes and ignores the CSS — without them the mark
 * renders at its intrinsic 1000-odd pixels wide and blows the layout open.
 */
export function logoImgTag(): string {
  const src = loadLogo()
    ? `cid:${LOGO_CID}`
    : `${env.APP_URL}/email-logo.png`

  return `<img src="${src}" alt="Three33 Barbershop" width="200" height="28" style="display:inline-block;width:200px;height:28px;border:0;outline:none;text-decoration:none" />`
}
