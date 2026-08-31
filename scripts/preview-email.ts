/**
 * Renders the order receipt to an HTML file so the template can be looked at
 * without settling a real payment and without sending mail.
 *
 * This exists because of a bug that only showed up in a customer's inbox: the
 * receipt declared no colour scheme, dark-mode mail clients repainted its
 * backgrounds and left the text colours alone, and the mail arrived black on
 * black. Nothing in the type system or the test suite can see that. Open the
 * output in a browser and toggle the OS theme; see lib/server/email/shell.ts
 * for what is supposed to hold it still.
 *
 *   npm run mail:preview
 *
 * The wordmark ships as a cid: attachment (lib/server/email/logo.ts), which a
 * browser cannot resolve, so the preview swaps in the same bytes as a data URI.
 */
import { writeFileSync } from 'node:fs'
import { logoAttachment } from '~/lib/server/email/logo'
import type { Mungu } from '~/lib/money'
import { renderReceipt } from '~/lib/server/orders/receipt'

const mnt = (tugrik: number) => (tugrik * 100) as Mungu

const logo = logoAttachment()
console.log(
  logo
    ? `logo: embedded, ${Math.round((logo.base64.length * 3) / 4 / 1024)}KB`
    : 'logo: NOT FOUND — the email will fall back to a remote URL',
)

const { html } = renderReceipt(
  {
    orderNo: 'T33-260831-0042',
    name: 'Тэмүүлэн',
    subtotal: mnt(90_000),
    shippingFee: mnt(0),
    total: mnt(90_000),
    createdAt: new Date(),
  },
  [
    { name: 'Deluxe Pomade', sku: 'UC-DP-100', unitPrice: mnt(45_000), qty: 1 },
    { name: 'Matte Pomade', sku: 'UC-MP-100', unitPrice: mnt(45_000), qty: 1 },
  ],
  null,
)

const out = process.argv[2] ?? 'receipt-preview.html'
writeFileSync(
  out,
  logo
    ? html.replace('cid:three33-logo', `data:image/png;base64,${logo.base64}`)
    : html,
)
console.log(`wrote ${out} — open it and toggle your OS light/dark setting`)

/*
 * Importing the receipt module pulls in ~/db, which opens a connection pool
 * (or a PGlite instance) that nothing here closes. Without this the script
 * renders its file and then sits there forever.
 */
process.exit(0)
