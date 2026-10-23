/**
 * Prints an order and its payment row. Development aid for confirming what
 * checkout actually wrote, without opening a SQL client.
 *
 * Usage: npm run order:inspect -- <orderNo>      (local D1)
 */
import { eq } from 'drizzle-orm'
import { orderItems, orders, payments } from '~/db/schema'
import { formatMnt } from '~/lib/money'
import { useLocalD1 } from './lib/local-d1'

// Before importing ~/db, which builds its client from the binding at load.
const local = await useLocalD1()
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
  await local.dispose()
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
  console.log(
    `payment  ${payment.provider} ${payment.status} invoice=${payment.invoiceId}`,
  )
  console.log(`  payment_id: ${payment.paymentId ?? '(none)'}`)
  const payload = payment.invoicePayload
  console.log(`  stored links: ${payload?.links.length ?? 0}`)
}

await local.dispose()
process.exit(0)
