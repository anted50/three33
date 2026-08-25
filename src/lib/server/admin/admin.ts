import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { inventoryLedger, orders, productVariants } from '~/db/schema'
import { assertTransition } from '../orders/state'
import { loadShippingRates, saveShippingRates } from '../settings'
import {
  assertAdmin,
  categoryOptions,
  dashboard,
  insertCategory,
  insertProduct,
  insertVariant,
  listCategories,
  listOrders,
  listOrdersForExport,
  listProducts,
  listVariants,
  orderDetail,
  productDetail,
  removeCategory,
  removeVariant,
  replaceProductImages,
  updateCategorySortOrder,
  updateProductRow,
} from './internal'
import { formatAddress } from '~/lib/address'
import { munguToTugrik } from '~/lib/money'
import { STATUS_LABEL } from '~/lib/order-status'

/**
 * Admin's public surface. Routes import from HERE only.
 * Exports server functions and types, nothing else — see cart/cart.ts.
 */

export const getDashboard = createServerFn({ method: 'GET' }).handler(() =>
  dashboard(),
)

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

export const getOrdersInput = z.object({
  status: z.string().max(32).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export const getOrders = createServerFn({ method: 'GET' })
  .validator(getOrdersInput)
  .handler(({ data }) => listOrders(data))

export const exportOrdersInput = z.object({
  status: z.string().max(32).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
})

/**
 * The date filter and status chip apply; pagination doesn't — the point of
 * an export is everything that matches, not just the page on screen.
 *
 * exceljs is dynamically imported so it never ends up in a client bundle —
 * same reasoning as the dynamic settings import in cart/cart.ts.
 */
export const exportOrders = createServerFn({ method: 'POST' })
  .validator(exportOrdersInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    const rows = await listOrdersForExport(data)

    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Захиалга')

    sheet.columns = [
      { header: 'Дугаар', key: 'orderNo', width: 20 },
      { header: 'Огноо', key: 'date', width: 12 },
      { header: 'Хэрэглэгч', key: 'name', width: 22 },
      { header: 'Утас', key: 'phone', width: 14 },
      { header: 'Хаяг', key: 'address', width: 40 },
      { header: 'Ширхэг', key: 'items', width: 10 },
      { header: 'Дүн (₮)', key: 'total', width: 14 },
      { header: 'Төлөв', key: 'status', width: 18 },
    ]
    sheet.getRow(1).font = { bold: true }

    for (const row of rows) {
      sheet.addRow({
        orderNo: row.orderNo,
        date: new Date(row.createdAt).toLocaleDateString('mn-MN'),
        name: row.address?.name ?? '—',
        phone: row.phone,
        address: row.address ? formatAddress(row.address) : '—',
        items: row.items,
        total: munguToTugrik(row.total),
        status: STATUS_LABEL[row.status],
      })
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return {
      filename: `zahialga-${new Date().toISOString().slice(0, 10)}.xlsx`,
      base64: Buffer.from(buffer).toString('base64'),
    }
  })

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
    await assertAdmin()

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
    await assertAdmin()

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

export const getCategories = createServerFn({ method: 'GET' }).handler(() =>
  listCategories(),
)

export const createCategoryInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'зөвхөн латин жижиг үсэг, тоо, зураас'),
  nameMn: z.string().trim().min(1).max(100),
  nameEn: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999),
})

export const createCategory = createServerFn({ method: 'POST' })
  .validator(createCategoryInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    try {
      return await insertCategory(data)
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === '23505'
      ) {
        throw new Error('Ийм slug-тай ангилал аль хэдийн бүртгэлтэй байна')
      }
      throw err
    }
  })

export const deleteCategoryInput = z.object({ categoryId: z.uuid() })

export const deleteCategory = createServerFn({ method: 'POST' })
  .validator(deleteCategoryInput)
  .handler(async ({ data }) => {
    await assertAdmin()
    return removeCategory(data.categoryId)
  })

export const setCategorySortOrderInput = z.object({
  categoryId: z.uuid(),
  sortOrder: z.number().int().min(0).max(9999),
})

export const setCategorySortOrder = createServerFn({ method: 'POST' })
  .validator(setCategorySortOrderInput)
  .handler(async ({ data }) => {
    await assertAdmin()
    return updateCategorySortOrder(data.categoryId, data.sortOrder)
  })

/**
 * An http(s) URL — images are hosted elsewhere (Shopify's CDN today). A
 * site-relative path is also accepted: the packshots seeded into public/ are
 * stored that way, and rejecting them would make their products unsaveable.
 */
const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .regex(
    /^(https?:\/\/|\/)\S*$/i,
    'Зургийн хаяг http://, https:// эсвэл / -ээр эхлэх ёстой',
  )

export const productImageInput = z.object({
  url: imageUrl,
  alt: z.string().max(200).optional(),
})

export const productVariantInput = z.object({
  sku: z.string().trim().min(1).max(64),
  size: z.string().trim().max(64).optional(),
  /** Mungu. Integer only — see lib/money.ts. */
  price: z.number().int().min(0).max(1_000_000_000),
  stockQty: z.number().int().min(0).max(1_000_000),
})

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
  variants: z.array(productVariantInput).min(1).max(20),
  images: z.array(productImageInput).max(10),
})

/**
 * Registers a new product with its sellable variants. Unique slug/SKU
 * violations come back from Postgres as code 23505 — surfaced here as a
 * message a shop owner can act on instead of the raw driver error.
 */
export const createProduct = createServerFn({ method: 'POST' })
  .validator(createProductInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    const skus = data.variants.map((v) => v.sku)
    if (new Set(skus).size !== skus.length) {
      throw new Error('Хувилбаруудын SKU давхардсан байна')
    }

    try {
      return await insertProduct({
        slug: data.slug,
        nameMn: data.nameMn,
        nameEn: data.nameEn,
        descriptionMn: data.descriptionMn ?? null,
        categoryId: data.categoryId ?? null,
        brandLine: data.brandLine ?? null,
        status: data.status,
        variants: data.variants.map((v) => ({
          sku: v.sku,
          size: v.size || null,
          price: v.price,
          stockQty: v.stockQty,
        })),
        images: data.images.map((i) => ({ url: i.url, alt: i.alt || null })),
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

export const addVariantInput = z.object({
  slug: z.string().min(1).max(128),
  variant: productVariantInput,
})

/**
 * Adds a variant to a product that already has a listing — a new size the
 * supplier just started carrying, say. Separate from createProduct because
 * the product row, its slug, and its other variants are untouched.
 */
export const addVariant = createServerFn({ method: 'POST' })
  .validator(addVariantInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    try {
      return await insertVariant(data.slug, {
        sku: data.variant.sku,
        size: data.variant.size || null,
        price: data.variant.price,
        stockQty: data.variant.stockQty,
      })
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === '23505'
      ) {
        throw new Error('Ийм SKU аль хэдийн бүртгэлтэй байна')
      }
      throw err
    }
  })

export const deleteVariantInput = z.object({ variantId: z.uuid() })

export const deleteVariant = createServerFn({ method: 'POST' })
  .validator(deleteVariantInput)
  .handler(async ({ data }) => {
    await assertAdmin()
    return removeVariant(data.variantId)
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
    await assertAdmin()

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

export const setProductImagesInput = z.object({
  slug: z.string().min(1).max(128),
  images: z.array(productImageInput).max(10),
})

export const setProductImages = createServerFn({ method: 'POST' })
  .validator(setProductImagesInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    return replaceProductImages(
      data.slug,
      data.images.map((i) => ({ url: i.url, alt: i.alt || null })),
    )
  })

export const getVariants = createServerFn({ method: 'GET' }).handler(() =>
  listVariants(),
)

export const receiveStockInput = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.uuid(),
        /** Units arriving. 0 means "only correct the price". */
        qty: z.number().int().min(0).max(1_000_000),
        /** Mungu. The new selling price for this variant. */
        price: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(200),
})

/**
 * A goods-received note: several variants restocked and repriced in one pass.
 *
 * One transaction for the whole sheet — a delivery that half-applied would
 * leave the shop guessing which lines it still has to enter. Each arriving unit
 * writes a `restock` ledger row, same as a single-variant edit does, so the
 * stock number keeps its explanation.
 */
export const receiveStock = createServerFn({ method: 'POST' })
  .validator(receiveStockInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    return db.transaction(async (tx) => {
      for (const line of data.lines) {
        const [current] = await tx
          .select({ stockQty: productVariants.stockQty })
          .from(productVariants)
          .where(eq(productVariants.id, line.variantId))
          .for('update')
          .limit(1)

        if (!current) throw new Error('Хувилбар олдсонгүй')

        await tx
          .update(productVariants)
          .set({
            price: line.price,
            stockQty: current.stockQty + line.qty,
          })
          .where(eq(productVariants.id, line.variantId))

        if (line.qty > 0) {
          await tx.insert(inventoryLedger).values({
            variantId: line.variantId,
            delta: line.qty,
            reason: 'restock',
          })
        }
      }

      return { ok: true as const, lines: data.lines.length }
    })
  })

export const getShopSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    await assertAdmin()
    return loadShippingRates()
  },
)

export const setShippingRatesInput = z.object({
  /** Mungu. */
  fee: z.number().int().min(0).max(100_000_000),
  freeThreshold: z.number().int().min(0).max(10_000_000_000),
})

export const setShippingRates = createServerFn({ method: 'POST' })
  .validator(setShippingRatesInput)
  .handler(async ({ data }) => {
    await assertAdmin()

    await saveShippingRates(data)
    return { ok: true as const }
  })
