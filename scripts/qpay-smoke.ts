/**
 * End-to-end QPay smoke test, driven through the real QpayProvider rather than
 * a parallel implementation — the point is to exercise the code checkout will
 * actually use.
 *
 * SAFETY
 * ------
 * Creating an invoice moves no money. It mints a QR and a set of bank
 * deeplinks; you are charged only if someone scans and pays. So `create` and
 * `check` are free to run against the production credentials.
 *
 * What it does cost: a row in the merchant portal, and a permanently burnt
 * sender_invoice_no. Test invoices are therefore prefixed TEST- with a
 * timestamp, so they can never collide with a real order_no.
 *
 * Usage:
 *   npx tsx scripts/qpay-smoke.ts create [amountTugrik]   # default 10
 *   npx tsx scripts/qpay-smoke.ts check  <invoiceId> [amountTugrik]
 *   npx tsx scripts/qpay-smoke.ts watch  <invoiceId> [amountTugrik]
 *   npx tsx scripts/qpay-smoke.ts cancel <invoiceId>
 */
import { formatMnt, tugrikToMungu } from '~/lib/money'
import { env } from '~/lib/server/env'
import { buildCallbackUrl } from '~/lib/server/payments/callback-token'
import { getQpayProvider } from '~/lib/server/payments/qpay'

const [command, arg1, arg2] = process.argv.slice(2)
const provider = getQpayProvider()

/** Marks the invoice as ours-and-disposable in the QPay merchant portal. */
function testOrderNo(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `TEST-${stamp}`
}

async function create(amountTugrik: number) {
  const orderNo = testOrderNo()
  const amount = tugrikToMungu(amountTugrik)

  // The real callback URL, HMAC and all — so the signing path is exercised
  // even though QPay cannot reach localhost.
  const callbackUrl = buildCallbackUrl(
    env.APP_URL,
    orderNo,
    env.QPAY_CALLBACK_SECRET,
  )

  console.log(`creating invoice ${orderNo} for ${formatMnt(amount)}`)
  console.log(`callback: ${callbackUrl}`)
  console.log('')

  const invoice = await provider.createInvoice({
    orderNo,
    amount,
    description: `Test order ${orderNo}`,
    callbackUrl,
  })

  console.log(`invoice_id : ${invoice.invoiceId}`)
  console.log(`short url  : ${invoice.shortUrl ?? '(none)'}`)
  console.log(`qr_text    : ${invoice.qrText.slice(0, 60)}...`)
  console.log(`qr_image   : ${invoice.qrImage.length} chars of base64 PNG`)
  console.log(`bank links : ${invoice.links.length}`)
  for (const link of invoice.links.slice(0, 6)) {
    console.log(`  ${link.name.padEnd(28)} ${link.link.slice(0, 48)}...`)
  }

  console.log('')
  console.log('Open the short URL on a phone to pay, then:')
  console.log(`  npx tsx scripts/qpay-smoke.ts watch ${invoice.invoiceId} ${amountTugrik}`)
  console.log('Or, to throw it away without paying:')
  console.log(`  npx tsx scripts/qpay-smoke.ts cancel ${invoice.invoiceId}`)
}

async function check(invoiceId: string, amountTugrik: number) {
  const result = await provider.checkInvoice(
    invoiceId,
    tugrikToMungu(amountTugrik),
  )
  console.log(`outcome  : ${result.outcome}`)
  console.log(`paid     : ${formatMnt(result.paidAmount)}`)
  console.log(`paymentId: ${result.providerPaymentId ?? '(none)'}`)
  return result
}

/** Mirrors what the payment page will do: poll until it settles or times out. */
async function watch(invoiceId: string, amountTugrik: number) {
  const deadline = Date.now() + 5 * 60_000

  while (Date.now() < deadline) {
    const result = await check(invoiceId, amountTugrik)
    if (result.outcome !== 'unpaid') {
      console.log('\nsettled — this is the point the order would flip to paid')
      return
    }
    console.log('  still unpaid, retrying in 3s\n')
    await new Promise((r) => setTimeout(r, 3000))
  }

  console.log('\ntimed out. The reconciliation sweep would pick this up.')
}

async function main() {
  if (env.QPAY_BASE_URL.includes('sandbox')) {
    console.log('mode: SANDBOX\n')
  } else {
    console.log('mode: PRODUCTION — invoices are real and payable\n')
  }

  switch (command) {
    case 'create':
      return create(Number(arg1 ?? 10))
    case 'check':
      if (!arg1) throw new Error('check needs an invoice id')
      await check(arg1, Number(arg2 ?? 10))
      return
    case 'watch':
      if (!arg1) throw new Error('watch needs an invoice id')
      return watch(arg1, Number(arg2 ?? 10))
    case 'cancel':
      if (!arg1) throw new Error('cancel needs an invoice id')
      await provider.cancelInvoice(arg1)
      console.log(`cancelled ${arg1}`)
      return
    default:
      console.log('commands: create [amount] | check <id> | watch <id> | cancel <id>')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('qpay-smoke failed:', error)
    process.exit(1)
  })
