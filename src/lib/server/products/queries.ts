import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, ilike, inArray, min, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import {
  categories,
  orderItems,
  orders,
  productImages,
  productVariants,
  products,
} from '~/db/schema'

/**
 * Read-only catalogue queries. Every one takes a zod-validated input, per
 * src/lib/server/README.md — including the ones that look too simple to need it,
 * since `slug` arrives straight from a URL.
 */

/**
 * Secondary nav modes, mirroring the reference site's tab row.
 *
 *  featured    — curated order (catalogue order, i.e. how it was seeded)
 *  new         — most recently added
 *  bestseller  — actual units sold on paid orders
 *
 * "Bestseller" is real data rather than a manual flag: order_items already
 * records what left the shop, so a badge nobody remembers to maintain would be
 * strictly worse.
 */
export const productSort = z.enum(['featured', 'new', 'bestseller'])
export type ProductSort = z.infer<typeof productSort>

export const listProductsInput = z.object({
  category: z.string().max(64).optional(),
  q: z.string().trim().max(64).optional(),
  sort: productSort.optional(),
})

/**
 * Builds the search predicate.
 *
 * ILIKE across a handful of columns, not full-text search or trigram: the
 * catalogue is 22 products and will not pass 100 SKUs. A GIN index would cost
 * a migration and an extension to speed up a query that already returns in
 * under a millisecond.
 *
 * Matches name (both languages), brand line, SKU and category, because people
 * search for all of them — "pomade", "UD-DP-100", "сахал" and "Featherweight"
 * are all things someone will type.
 */
function searchPredicate(raw: string) {
  /**
   * Escape LIKE wildcards. Drizzle parameterises the value so this is not an
   * injection concern — but a customer typing "100%" should search for the
   * literal text, not match every product in the shop.
   */
  const term = `%${raw.replace(/([\\%_])/g, '\\$1')}%`

  return or(
    ilike(products.nameMn, term),
    ilike(products.nameEn, term),
    ilike(products.brandLine, term),
    ilike(productVariants.sku, term),
    ilike(categories.nameMn, term),
    ilike(categories.nameEn, term),
  )
}

export interface ProductCard {
  slug: string
  name: string
  size: string | null
  /** Lowest active variant price, in mungu. */
  fromPrice: number
  totalStock: number
  variantCount: number
  imageUrl: string | null
}

export const listCategories = createServerFn({ method: 'GET' }).handler(
  async () => {
    return db
      .select({
        slug: categories.slug,
        nameMn: categories.nameMn,
        nameEn: categories.nameEn,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder))
  },
)

export const listProducts = createServerFn({ method: 'GET' })
  .validator(listProductsInput)
  .handler(async ({ data }): Promise<ProductCard[]> => {
    const rows = await db
      .select({
        slug: products.slug,
        name: products.nameMn,
        fromPrice: min(productVariants.price),
        totalStock: sql<number>`coalesce(sum(${productVariants.stockQty}), 0)::int`,
        variantCount: sql<number>`count(${productVariants.id})::int`,
        size: sql<string | null>`min(${productVariants.size})`,
        // Correlated subquery rather than another join: product_images would
        // multiply the rows this GROUP BY is already aggregating over.
        imageUrl: sql<string | null>`(
          select ${productImages.url}
          from ${productImages}
          where ${productImages.productId} = ${products.id}
          order by ${productImages.sortOrder}
          limit 1
        )`,
      })
      .from(products)
      .innerJoin(
        productVariants,
        and(
          eq(productVariants.productId, products.id),
          eq(productVariants.isActive, true),
        ),
      )
      .leftJoin(categories, eq(categories.id, products.categoryId))
      // Category and search compose: searching inside a filtered category is
      // what a chip plus a query field visibly implies.
      .where(
        and(
          eq(products.status, 'active'),
          data.category ? eq(categories.slug, data.category) : undefined,
          data.q ? searchPredicate(data.q) : undefined,
        ),
      )
      .groupBy(products.id, products.slug, products.nameMn, products.createdAt)
      .orderBy(
        data.sort === 'new' ? desc(products.createdAt) : asc(products.createdAt),
      )

    if (data.sort === 'bestseller') {
      /**
       * Units sold, in a separate query rather than another join.
       *
       * Joining order_items into the query above would multiply the rows its
       * GROUP BY is already aggregating, quietly inflating stock and variant
       * counts. With a catalogue this size a second round trip and a sort in
       * memory is cheaper than getting that subtle.
       */
      const sold = await db
        .select({
          slug: products.slug,
          units: sql<number>`coalesce(sum(${orderItems.qty}), 0)::int`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        // Only orders where the money actually arrived.
        .where(inArray(orders.status, ['paid', 'processing', 'shipped', 'delivered']))
        .groupBy(products.slug)

      const unitsBySlug = new Map(sold.map((s) => [s.slug, s.units]))
      rows.sort(
        (a, b) => (unitsBySlug.get(b.slug) ?? 0) - (unitsBySlug.get(a.slug) ?? 0),
      )
    }

    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      size: row.variantCount === 1 ? row.size : null,
      fromPrice: Number(row.fromPrice ?? 0),
      totalStock: row.totalStock,
      variantCount: row.variantCount,
      imageUrl: row.imageUrl,
    }))
  })

export const getProductInput = z.object({
  slug: z.string().min(1).max(128),
})

export const getProduct = createServerFn({ method: 'GET' })
  .validator(getProductInput)
  .handler(async ({ data }) => {
    const [product] = await db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.nameMn,
        description: products.descriptionMn,
        brandLine: products.brandLine,
        categorySlug: categories.slug,
        categoryName: categories.nameMn,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(and(eq(products.slug, data.slug), eq(products.status, 'active')))
      .limit(1)

    if (!product) return null

    const variants = await db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        size: productVariants.size,
        price: productVariants.price,
        compareAtPrice: productVariants.compareAtPrice,
        stockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, product.id),
          eq(productVariants.isActive, true),
        ),
      )
      .orderBy(asc(productVariants.price))

    const images = await db
      .select({ url: productImages.url, alt: productImages.alt })
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(asc(productImages.sortOrder))

    // The id is internal; the browser gets slugs and variant ids only.
    const { id: _id, ...rest } = product
    return { ...rest, variants, images }
  })
