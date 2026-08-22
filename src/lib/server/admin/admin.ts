import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { inventoryLedger, orders, productVariants } from '~/db/schema'
import { assertTransition } from '../orders/state'
import {
  assertAdmin,
  categoryOptions,
  dashboard,
  insertProduct,
  listOrders,
  listProducts,
  orderDetail,
  productDetail,
  updateProductRow,
} from './internal'

/**
 * Admin's public surface. Routes import from HERE only.
 * Exports server functions and types, nothing else — see cart/cart.ts.
 */

export const getDashboard = createServerFn({ method: 'GET' }).handler(() =>
  dashboard(),
)

export const getOrdersInput = z.object({
  status: z.string().max(32).optional(),
})

export const getOrders = createServerFn({ method: 'GET' })
  .validator(getOrdersInput)
  .handler(({ data }) => listOrders(data.status))

export const orderNoInput = z.object({ orderNo: z.string().min(1).max(45) })

export const getOrderDetail = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(({ data }) => orderDetail(data.orderNo))

export const getProducts = createServerFn({ method: 'GET' }).handler(() =>
  listProducts(),
)

export const slugInput = z.object({ slug: z.string().min(1).max(128) })

export const getProductDetail = createServerFn({ method: 'GET' })
  .validator(slugInput)
  .handler(({ data }) => productDetail(data.slug))

export const setOrderStatusInput = z.object({
  orderNo: z.string().min(1).max(45),
  status: z.enum([
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'expired',
  ]),
})

/**
 * Moves an order along. Refuses illegal jumps via the same state machine the
 * payment path uses — an admin can make a mistake as easily as a callback can.
 */
export const setOrderStatus = createServerFn({ method: 'POST' })
  .validator(setOrderStatusInput)
  .handler(async ({ data }) => {
    assertAdmin()

    return db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.orderNo, data.orderNo))
        .for('update')
        .limit(1)

      if (!order) throw new Error('Захиалга олдсонгүй')

      assertTransition(order.status, data.status)

      await tx
        .update(orders)
        .set({ status: data.status })
        .where(eq(orders.id, order.id))

      return { ok: true as const, status: data.status }
    })
  })

export const setVariantInput = z.object({
  variantId: z.uuid(),
  /** Mungu. Integer only — see lib/money.ts. */
  price: z.number().int().min(0).max(1_000_000_000),
  stockQty: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
})

/**
 * Edits price and stock. Any stock change writes an inventory_ledger row in the
 * same transaction, so the number in product_variants always has an
 * explanation — that invariant is the whole point of the ledger.
 */
export const setVariant = createServerFn({ method: 'POST' })
  .validator(setVariantInput)
  .handler(async ({ data }) => {
    assertAdmin()

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: productVariants.id,
          stockQty: productVariants.stockQty,
        })
        .from(productVariants)
        .where(eq(productVariants.id, data.variantId))
        .for('update')
        .limit(1)

      if (!current) throw new Error('Хувилбар олдсонгүй')

      await tx
        .update(productVariants)
        .set({
          price: data.price,
          stockQty: data.stockQty,
          isActive: data.isActive,
        })
        .where(eq(productVariants.id, data.variantId))

      const delta = data.stockQty - current.stockQty
      if (delta !== 0) {
        await tx.insert(inventoryLedger).values({
          variantId: data.variantId,
          delta,
          reason: delta > 0 ? 'restock' : 'manual_adjustment',
        })
      }

      return { ok: true as const }
    })
  })

export const getCategoryOptions = createServerFn({ method: 'GET' }).handler(
  () => categoryOptions(),
)

export const createProductInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'зөвхөн латин жижиг үсэг, тоо, зураас'),
  nameMn: z.string().min(1).max(200),
  nameEn: z.string().min(1).max(200),
  descriptionMn: z.string().max(4000).optional(),
  categoryId: z.uuid().optional(),
  brandLine: z.string().max(200).optional(),
  status: z.enum(['draft', 'active', 'archived']),
  sku: z.string().min(1).max(64),
  size: z.string().max(64).optional(),
  /** Mungu. Integer only — see lib/money.ts. */
  price: z.number().int().min(0).max(1_000_000_000),
  stockQty: z.number().int().min(0).max(1_000_000),
})

/**
 * Registers a new product with its first sellable variant. Unique slug/SKU
 * violations come back from Postgres as code 23505 — surfaced here as a
 * message a shop owner can act on instead of the raw driver error.
 */
export const createProduct = createServerFn({ method: 'POST' })
  .validator(createProductInput)
  .handler(async ({ data }) => {
    assertAdmin()

    try {
      return await insertProduct({
        slug: data.slug,
        nameMn: data.nameMn,
        nameEn: data.nameEn,
        descriptionMn: data.descriptionMn ?? null,
        categoryId: data.categoryId ?? null,
        brandLine: data.brandLine ?? null,
        status: data.status,
        sku: data.sku,
        size: data.size ?? null,
        price: data.price,
        stockQty: data.stockQty,
      })
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === '23505'
      ) {
        throw new Error('Ийм slug эсвэл SKU аль хэдийн бүртгэлтэй байна')
      }
      throw err
    }
  })

export const updateProductInput = z.object({
  slug: z.string().min(1).max(128),
  nameMn: z.string().min(1).max(200),
  nameEn: z.string().min(1).max(200),
  descriptionMn: z.string().max(4000).optional(),
  categoryId: z.uuid().optional(),
  brandLine: z.string().max(200).optional(),
  status: z.enum(['draft', 'active', 'archived']),
})

export const updateProduct = createServerFn({ method: 'POST' })
  .validator(updateProductInput)
  .handler(async ({ data }) => {
    assertAdmin()

    return updateProductRow({
      slug: data.slug,
      nameMn: data.nameMn,
      nameEn: data.nameEn,
      descriptionMn: data.descriptionMn ?? null,
      categoryId: data.categoryId ?? null,
      brandLine: data.brandLine ?? null,
      status: data.status,
    })
  })
