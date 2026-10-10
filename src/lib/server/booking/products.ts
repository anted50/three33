import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { products, productVariants } from '~/db/schema'

/**
 * What a barber can ring up: active products with their active variants,
 * listed price and current stock. Read-only — prices and stock stay the
 * owner's.
 */
export const productsQuery = z.object({ q: z.string().trim().max(60).optional() })

export async function sellableProducts(query: z.infer<typeof productsQuery>) {
  const rows = await db
    .select({
      productId: products.id,
      nameEn: products.nameEn,
      nameMn: products.nameMn,
      brandLine: products.brandLine,
      variantId: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      price: productVariants.price,
      stockQty: productVariants.stockQty,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.status, 'active'), eq(productVariants.isActive, true)))
    .orderBy(asc(products.nameEn), asc(productVariants.sku))

  const needle = query.q?.toLowerCase()
  const matches = needle
    ? rows.filter((r) => [r.nameEn, r.nameMn, r.sku, r.brandLine ?? ''].some((v) => v.toLowerCase().includes(needle)))
    : rows

  const byProduct = new Map<string, { productId: string; nameEn: string; nameMn: string; brandLine: string | null; variants: unknown[] }>()
  for (const r of matches) {
    const entry = byProduct.get(r.productId) ?? { productId: r.productId, nameEn: r.nameEn, nameMn: r.nameMn, brandLine: r.brandLine, variants: [] }
    entry.variants.push({ id: r.variantId, sku: r.sku, size: r.size, price: r.price, stockQty: r.stockQty })
    byProduct.set(r.productId, entry)
  }
  return [...byProduct.values()]
}
