import { describe, expect, it, vi } from 'vitest'
import { atomic, insertRows } from '~/db/atomic'
import { db } from '~/db'
import { orderItems, orders, payments, productImages, productVariants, products } from '~/db/schema'

/**
 * The admin read paths on a real local D1: that the queries the admin pages
 * are built from return the rows, counts and order the pages show. The
 * session check is faked; what is under test is the SQL.
 */

vi.mock('./auth-internal', () => ({ assertAdminSession: vi.fn(async () => ({ id: 'admin' })) }))

const { dashboard, listOrders, orderDetail, productDetail, removeVariant } = await import('./internal')

let sequence = 0

/**
 * An order whose lines are inserted in the given order. Line ids are random
 * UUIDs, so any query that orders by id would shuffle them.
 */
async function orderWithLines(lineNames: string[], status: 'paid' | 'pending_payment' = 'paid') {
  const number = ++sequence
  const orderId = crypto.randomUUID()
  const orderNo = `A-${number}`
  await atomic([
    db.insert(orders).values({
      id: orderId,
      orderNo,
      status,
      subtotal: 1000,
      shippingFee: 0,
      total: 1000,
      shippingAddressSnapshot: { name: null, phone: '99112233', email: null, address: 'UB' },
      contactPhone: '99112233',
      expiresAt: new Date(Date.now() + 3600e3),
      accessTokenHash: 'h',
      // Newest of all, so the dashboard's five most recent include it.
      createdAt: new Date(Date.now() + number * 1000),
    }),
    ...insertRows(
      orderItems,
      lineNames.map((name) => ({ orderId, skuSnapshot: 'CUSTOM', nameSnapshot: name, unitPrice: 500, qty: 2 })),
    ),
    db.insert(payments).values({ orderId, provider: 'qpay', invoiceId: `INV-${number}`, amount: 1000 }),
  ])
  return { orderId, orderNo }
}

async function productWithVariants(variantCount: number) {
  const number = ++sequence
  const productId = crypto.randomUUID()
  const variantIds = Array.from({ length: variantCount }, () => crypto.randomUUID())
  await atomic([
    db.insert(products).values({ id: productId, slug: `p-${number}`, nameMn: 'p', nameEn: 'p', status: 'active' }),
    ...insertRows(
      productVariants,
      variantIds.map((id, index) => ({ id, productId, sku: `SKU-${number}-${index}`, price: 1000 + index, stockQty: 3 })),
    ),
    db.insert(productImages).values({ productId, url: '/a.jpg', alt: null, sortOrder: 0 }),
  ])
  return { slug: `p-${number}`, variantIds }
}

describe('dashboard', () => {
  it('shows each recent order\'s first line and its line count', async () => {
    // Goal: the correlated subqueries must see the outer order. A bare "id"
    // resolved to order_items.id, so every order showed no item and 0 lines.
    const { orderNo } = await orderWithLines(['Clay', 'Comb', 'Oil'])
    const result = await dashboard()
    const recent = result.recent.find((order) => order.orderNo === orderNo)
    expect(recent?.item).toBe('Clay')
    expect(recent?.lines).toBe(3)
    expect(result.salesSeries.length).toBeGreaterThan(0)
    expect(result.salesSeries.length).toBeLessThanOrEqual(31)
  })
})

describe('orderDetail', () => {
  it('returns the lines in the order they were entered, with the payment', async () => {
    const names = ['first', 'second', 'third', 'fourth', 'fifth']
    const { orderNo } = await orderWithLines(names)
    const detail = await orderDetail(orderNo)
    expect(detail?.items.map((item) => item.name)).toEqual(names)
    expect(detail?.payment?.provider).toBe('qpay')
    expect(detail).not.toHaveProperty('id')
  })

  it('returns null for an order that does not exist', async () => {
    expect(await orderDetail('NO-SUCH-ORDER')).toBeNull()
  })
})

describe('listOrders', () => {
  it('pages the rows and counts every match', async () => {
    for (let index = 0; index < 3; index++) await orderWithLines(['x'])
    const firstPage = await listOrders({ status: 'paid', page: 1, pageSize: 2 })
    expect(firstPage.rows).toHaveLength(2)
    expect(firstPage.total).toBeGreaterThanOrEqual(3)
    expect(firstPage.rows[0]?.items).toBe(2)

    const pastTheEnd = await listOrders({ status: 'paid', page: 1000, pageSize: 2 })
    expect(pastTheEnd.rows).toHaveLength(0)
    expect(pastTheEnd.total).toBe(firstPage.total)
  })

  it('keeps unpaid checkouts out of "all"', async () => {
    const { orderNo } = await orderWithLines(['x'], 'pending_payment')
    const all = await listOrders({ status: 'all', pageSize: 100 })
    expect(all.rows.map((row) => row.orderNo)).not.toContain(orderNo)
  })
})

describe('productDetail and removeVariant', () => {
  it('returns the variants cheapest first, and the images', async () => {
    const { slug } = await productWithVariants(2)
    const detail = await productDetail(slug)
    expect(detail?.variants.map((variant) => variant.price)).toEqual([1000, 1001])
    expect(detail?.images).toHaveLength(1)
  })

  it('removes a spare variant but refuses the last one', async () => {
    const { slug, variantIds } = await productWithVariants(2)
    await removeVariant(variantIds[0]!)
    await expect(removeVariant(variantIds[1]!)).rejects.toThrow('ядаж нэг хувилбар')
    expect((await productDetail(slug))?.variants).toHaveLength(1)
  })
})
