import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { apiErrorFromDb } from '~/lib/server/api/db-errors'
import { atomic, changed, exists, guard } from './atomic'
import { db } from './index'
import { appointments, orders, payments, productVariants, products, users } from './schema'

async function rejectionOf(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e,
  )
}

describe('atomic + guard on D1', () => {
  it('applies every statement when the guards hold', async () => {
    const productId = crypto.randomUUID()
    await atomic([
      guard(sql`1 = 1`, 'NEVER'),
      db.insert(products).values({ id: productId, slug: 'p-ok', nameMn: 'p', nameEn: 'p' }),
      db.insert(productVariants).values({ productId, sku: 'SKU-OK', price: 100, stockQty: 5 }),
    ])
    const rows = await db.select().from(productVariants).where(eq(productVariants.productId, productId))
    expect(rows).toHaveLength(1)
  })

  it('rolls the whole batch back with the guard code when a guard fails', async () => {
    const productId = crypto.randomUUID()
    const error = await rejectionOf(
      atomic([
        db.insert(products).values({ id: productId, slug: 'p-rolled-back', nameMn: 'p', nameEn: 'p' }),
        guard(exists(db.select().from(products).where(eq(products.slug, 'no-such-product'))), 'PRODUCT_GONE'),
      ]),
    )
    expect(apiErrorFromDb(error)).toMatchObject({ status: 409, code: 'PRODUCT_GONE' })
    // The insert before the guard did not survive.
    expect(await db.select().from(products).where(eq(products.id, productId))).toHaveLength(0)
  })

  it('changed() aborts when a conditional update matched nothing', async () => {
    const productId = crypto.randomUUID()
    const variantId = crypto.randomUUID()
    await atomic([
      db.insert(products).values({ id: productId, slug: 'p-stock', nameMn: 'p', nameEn: 'p' }),
      db.insert(productVariants).values({ id: variantId, productId, sku: 'SKU-STOCK', price: 100, stockQty: 2 }),
    ])
    const take = (qty: number) => [
      db
        .update(productVariants)
        .set({ stockQty: sql`${productVariants.stockQty} - ${qty}` })
        .where(sql`${productVariants.id} = ${variantId} and ${productVariants.stockQty} >= ${qty}`),
      changed('OUT_OF_STOCK'),
    ]

    await atomic(take(2))
    const error = await rejectionOf(atomic(take(1)))
    expect(apiErrorFromDb(error)).toMatchObject({ code: 'OUT_OF_STOCK' })
    const [row] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    expect(row!.stockQty).toBe(0)
  })

  it('a unique violation rolls back everything before it', async () => {
    const orderId = crypto.randomUUID()
    await db.insert(orders).values({
      id: orderId,
      orderNo: 'O-UNIQUE',
      subtotal: 100,
      shippingFee: 0,
      total: 100,
      shippingAddressSnapshot: { name: null, phone: '99', email: null },
      contactPhone: '99',
      expiresAt: new Date(Date.now() + 3600e3),
      accessTokenHash: 'h',
    })
    await db.insert(payments).values({ orderId, amount: 100, paymentId: 'PAY-1', status: 'paid', paidAt: new Date() })

    const error = await rejectionOf(
      atomic([
        db.update(orders).set({ status: 'paid' }).where(eq(orders.id, orderId)),
        db.insert(payments).values({ orderId, amount: 100, paymentId: 'PAY-1', status: 'paid', paidAt: new Date() }),
      ]),
    )
    expect(apiErrorFromDb(error)).toMatchObject({ status: 409 })
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
    expect(order!.status).toBe('pending_payment')
  })

  it('round-trips Date, JSON and boolean columns', async () => {
    const [order] = await db.select().from(orders).where(eq(orders.orderNo, 'O-UNIQUE'))
    expect(order!.expiresAt).toBeInstanceOf(Date)
    expect(order!.createdAt).toBeInstanceOf(Date)
    expect(Math.abs(order!.createdAt.getTime() - Date.now())).toBeLessThan(60_000)
    expect(order!.shippingAddressSnapshot).toEqual({ name: null, phone: '99', email: null })

    const [variant] = await db.select().from(productVariants).where(eq(productVariants.sku, 'SKU-OK'))
    expect(variant!.isActive).toBe(true)
  })

  it('maps the appointment overlap trigger to TIME_TAKEN', async () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h))
    const booking = (startH: number, endH: number) =>
      db.insert(appointments).values({
        bookingNo: `B-${startH}-${endH}`,
        serviceName: 'Haircut',
        durationMinutes: (endH - startH) * 60,
        status: 'booked',
        startsAt: at(startH),
        endsAt: at(endH),
        customerName: 'c',
        customerPhone: '99112233',
        customerEmail: 'c@example.com',
        bookingFee: 1_000_000,
        paidAt: new Date(),
        accessTokenHash: 'h',
      })

    await booking(10, 11)
    await booking(11, 12) // back to back is fine
    const error = await rejectionOf(booking(10, 12).then((r) => r))
    expect(apiErrorFromDb(error)).toMatchObject({ status: 409, code: 'TIME_TAKEN' })
  })

  it('maps a known unique column to its code', async () => {
    await db.insert(users).values({ email: 'dup@example.com', name: 'A' })
    const error = await rejectionOf(db.insert(users).values({ email: 'dup@example.com', name: 'B' }).then((r) => r))
    expect(apiErrorFromDb(error)).toMatchObject({ code: 'EMAIL_TAKEN' })
  })
})
