import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { atomic } from '~/db/atomic'
import { db } from '~/db'
import { cartItems, carts, inventoryLedger, orderItems, orders, payments, productVariants, products } from '~/db/schema'
import { isGuardFailure } from '../api/db-errors'

/**
 * The order payment path on a real local D1: settlement, its idempotency
 * under a race, overselling, and expiry. The provider is faked — what is
 * under test is what the database ends up holding.
 */

const provider = {
  name: 'qpay',
  createInvoice: vi.fn(),
  checkInvoice: vi.fn(),
  cancelInvoice: vi.fn(async () => {}),
}
vi.mock('../payments/registry', () => ({ getProvider: () => provider }))
vi.mock('./receipt', () => ({ sendOrderReceipt: vi.fn(async () => {}) }))

const { settleOrder, markPaid, orderStillPending, ALREADY_SETTLED } = await import('./settle')
const { expireCheckout } = await import('./expire')

let seq = 0

/** A product with one variant, a cart holding it, and a pending order for `qty` of it. */
async function pendingOrder({ stock, qty }: { stock: number; qty: number }) {
  const n = ++seq
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const cartId = crypto.randomUUID()
  const orderId = crypto.randomUUID()
  const orderNo = `T-${n}`
  await atomic([
    db.insert(products).values({ id: productId, slug: `p-${n}`, nameMn: 'p', nameEn: 'p', status: 'active' }),
    db.insert(productVariants).values({ id: variantId, productId, sku: `SKU-${n}`, price: 1000, stockQty: stock }),
    db.insert(carts).values({ id: cartId, sessionToken: `cart-${n}`, expiresAt: new Date(Date.now() + 86400e3) }),
    db.insert(cartItems).values({ cartId, variantId, qty, unitPriceSnapshot: 1000 }),
    db.insert(orders).values({
      id: orderId,
      orderNo,
      cartId,
      subtotal: 1000 * qty,
      shippingFee: 0,
      total: 1000 * qty,
      shippingAddressSnapshot: { name: null, phone: '99112233', email: null, address: 'UB' },
      contactPhone: '99112233',
      expiresAt: new Date(Date.now() + 3600e3),
      accessTokenHash: 'h',
    }),
    db.insert(orderItems).values({ orderId, variantId, skuSnapshot: `SKU-${n}`, nameSnapshot: 'p', unitPrice: 1000, qty }),
    db.insert(payments).values({ orderId, provider: 'qpay', invoiceId: `INV-${n}`, amount: 1000 * qty }),
  ])
  return { orderId, orderNo, variantId, cartId }
}

const stockOf = async (variantId: string) =>
  (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0]!.stockQty
const ledgerOf = (variantId: string) => db.select().from(inventoryLedger).where(eq(inventoryLedger.variantId, variantId))

beforeEach(() => {
  provider.checkInvoice.mockReset()
  provider.cancelInvoice.mockClear()
})

describe('settleOrder', () => {
  it('settles: status, stock, ledger, payment and cart in one go', async () => {
    const o = await pendingOrder({ stock: 3, qty: 2 })
    provider.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: 2000, providerPaymentId: 'PAY-A', raw: { ok: 1 } })

    expect(await settleOrder(o.orderNo)).toBe('settled')

    const [order] = await db.select().from(orders).where(eq(orders.id, o.orderId))
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, o.orderId))
    expect(order!.status).toBe('paid')
    expect(payment).toMatchObject({ status: 'paid', paymentId: 'PAY-A', rawCallback: { ok: 1 } })
    expect(payment!.paidAt).toBeInstanceOf(Date)
    expect(await stockOf(o.variantId)).toBe(1)
    expect(await ledgerOf(o.variantId)).toMatchObject([{ delta: -2, reason: 'order_paid', orderId: o.orderId }])
    expect(await db.select().from(cartItems).where(eq(cartItems.cartId, o.cartId))).toHaveLength(0)
  })

  it('answers already_settled the second time, without touching stock again', async () => {
    const o = await pendingOrder({ stock: 3, qty: 1 })
    provider.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: 1000, providerPaymentId: 'PAY-B', raw: {} })
    expect(await settleOrder(o.orderNo)).toBe('settled')
    expect(await settleOrder(o.orderNo)).toBe('already_settled')
    expect(await stockOf(o.variantId)).toBe(2)
  })

  it('records a short line as a zero-delta manual adjustment instead of overselling', async () => {
    const o = await pendingOrder({ stock: 1, qty: 5 })
    provider.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: 5000, providerPaymentId: 'PAY-C', raw: {} })
    expect(await settleOrder(o.orderNo)).toBe('settled')
    expect(await stockOf(o.variantId)).toBe(1)
    expect(await ledgerOf(o.variantId)).toMatchObject([{ delta: 0, reason: 'manual_adjustment' }])
  })

  it('leaves unpaid orders alone', async () => {
    const o = await pendingOrder({ stock: 1, qty: 1 })
    provider.checkInvoice.mockResolvedValue({ outcome: 'unpaid', paidAmount: 0, providerPaymentId: null, raw: {} })
    expect(await settleOrder(o.orderNo)).toBe('unpaid')
    const [order] = await db.select().from(orders).where(eq(orders.id, o.orderId))
    expect(order!.status).toBe('pending_payment')
  })
})

describe('two settlements racing', () => {
  it('lets exactly one land; the other aborts on the guard', async () => {
    const o = await pendingOrder({ stock: 5, qty: 2 })
    const order = { id: o.orderId, cartId: o.cartId }
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, o.orderId))

    // Both built before either runs — the window a row lock used to close.
    const first = [orderStillPending(o.orderId), ...(await markPaid(order, payment!.id, { paymentId: 'RACE-1', rawCallback: {} }))]
    const second = [orderStillPending(o.orderId), ...(await markPaid(order, payment!.id, { paymentId: 'RACE-2', rawCallback: {} }))]

    const results = await Promise.allSettled([atomic(first), atomic(second)])
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(isGuardFailure((rejected[0] as PromiseRejectedResult).reason, ALREADY_SETTLED)).toBe(true)

    expect(await stockOf(o.variantId)).toBe(3)
    expect(await ledgerOf(o.variantId)).toHaveLength(1)
  })
})

describe('expireCheckout', () => {
  it('cancels the invoice, then expires the order and its payment', async () => {
    const o = await pendingOrder({ stock: 1, qty: 1 })
    expect(await expireCheckout(o.orderId, 'expired')).toBe(true)
    expect(provider.cancelInvoice).toHaveBeenCalledOnce()
    const [order] = await db.select().from(orders).where(eq(orders.id, o.orderId))
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, o.orderId))
    expect(order!.status).toBe('expired')
    expect(payment!.status).toBe('expired')
  })

  it('never expires an order that has been paid', async () => {
    const o = await pendingOrder({ stock: 1, qty: 1 })
    provider.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: 1000, providerPaymentId: 'PAY-D', raw: {} })
    await settleOrder(o.orderNo)
    expect(await expireCheckout(o.orderId, 'expired')).toBe(false)
    const [order] = await db.select().from(orders).where(eq(orders.id, o.orderId))
    expect(order!.status).toBe('paid')
  })
})
