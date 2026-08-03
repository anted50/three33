import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, min, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import {
  categories,
  productImages,
  productVariants,
  products,
} from '~/db/schema'

/**
 * Read-only catalogue queries. Every one takes a zod-validated input, per
 * src/lib/server/README.md — including the ones that look too simple to need it,
 * since `slug` arrives straight from a URL.
 */

export const listProductsInput = z.object({
  category: z.string().max(64).optional(),
})

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
      .where(
        data.category
          ? and(
              eq(products.status, 'active'),
              eq(categories.slug, data.category),
            )
          : eq(products.status, 'active'),
      )
      .groupBy(products.id, products.slug, products.nameMn, products.createdAt)
      .orderBy(asc(products.createdAt))

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
