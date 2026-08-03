/**
 * Prints an order and its payment row. Development aid for confirming what
 * checkout actually wrote, without opening a SQL client.
 *
 * Usage: npx tsx scripts/order-inspect.ts <orderNo>
 */
import { eq } from 'drizzle-orm'
import { orderItems, orders, payments } from '~/db/schema'
import { formatMnt } from '~/lib/money'
import { assertNoDevServer } from '~/lib/server/pglite-guard'

// Before importing ~/db — see scripts/migrate.ts.
await assertNoDevServer()
const { db } = await import('~/db')

const orderNo = process.argv[2]
if (!orderNo) {
  console.error('usage: npx tsx scripts/order-inspect.ts <orderNo>')
  process.exit(1)
}

const [order] = await db
  .select()
  .from(orders)
  .where(eq(orders.orderNo, orderNo))
  .limit(1)

if (!order) {
  console.error(`no such order: ${orderNo}`)
  process.exit(1)
}

console.log(`order    ${order.orderNo}`)
console.log(`status   ${order.status}`)
console.log(`subtotal ${formatMnt(order.subtotal)}`)
console.log(`shipping ${formatMnt(order.shippingFee)}`)
console.log(`total    ${formatMnt(order.total)}`)
console.log(`address  ${JSON.stringify(order.shippingAddressSnapshot)}`)

const items = await db
  .select()
  .from(orderItems)
  .where(eq(orderItems.orderId, order.id))

for (const item of items) {
  console.log(
    `  ${item.qty} x ${item.nameSnapshot} (${item.skuSnapshot}) @ ${formatMnt(item.unitPrice)}`,
  )
}

const [payment] = await db
  .select()
  .from(payments)
  .where(eq(payments.orderId, order.id))
  .limit(1)

if (payment) {
  console.log(`payment  ${payment.status} invoice=${payment.qpayInvoiceId}`)
  console.log(`  qpay_payment_id: ${payment.qpayPaymentId ?? '(none)'}`)
  const payload = payment.invoicePayload
  console.log(`  stored links: ${payload?.links.length ?? 0}`)
}

process.exit(0)
