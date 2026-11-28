import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, min, sql } from 'drizzle-orm'
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
import { assert } from '~/lib/assert'

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

export const listProductsInput = z.object({
  category: z.string().max(64).optional(),
  q: z.string().trim().max(64).optional(),
  sort: productSort.optional(),
})

/**
 * The most rows any whole-catalogue read returns. The shop has 22 products
 * and does not expect to pass 100 SKUs, so this is ten times that: it only
 * ever trips on a runaway catalogue, and when it does the cut is logged
 * rather than silently showing a short list.
 */
const CATALOGUE_ROWS_MAX = 1_000

/**
 * Per-product bounds for the product page. Far above what the admin forms
 * create (20 variants, 10 images); a product past them shows the first ones.
 */
const PRODUCT_VARIANTS_MAX = 100
const PRODUCT_IMAGES_MAX = 50

/** How many products the empty cart suggests. */
const CART_SUGGESTION_LIMIT = 4

/** Orders where the money actually arrived, which is what "sold" means. */
const SOLD_ORDER_STATUSES = ['paid', 'processing', 'shipped', 'delivered'] as const

/** Logs a whole-catalogue read that came back cut short by CATALOGUE_ROWS_MAX. */
function checkCatalogueBound(rowCount: number, query: string): void {
  assert(rowCount <= CATALOGUE_ROWS_MAX, `${query} honours CATALOGUE_ROWS_MAX`)
  if (rowCount === CATALOGUE_ROWS_MAX) {
    console.error(`[products] ${query} hit CATALOGUE_ROWS_MAX (${CATALOGUE_ROWS_MAX}); the result is cut short`)
  }
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
    const rows = await selectCategories()
    checkCatalogueBound(rows.length, 'listCategories')
    return rows
  },
)

function selectCategories() {
  return db
    .select({
      slug: categories.slug,
      nameMn: categories.nameMn,
      nameEn: categories.nameEn,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder))
    .limit(CATALOGUE_ROWS_MAX)
}

/**
 * A product's first image. A correlated subquery rather than another join:
 * product_images would multiply the rows a listing's GROUP BY (or its
 * one-row-per-variant select) is already working over.
 */
const firstImageUrl = sql<string | null>`(
  select ${productImages.url}
  from ${productImages}
  where ${productImages.productId} = ${products.id}
  order by ${productImages.sortOrder}
  limit 1
)`

/**
 * One row per active product with at least one active variant: what a
 * catalogue card shows, plus the id (for search) and the category slug (for
 * grouping). The inner join is what drops products with nothing to sell.
 */
function selectListingRows(options: { categorySlug: string | null; newestFirst: boolean }) {
  return db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.nameMn,
      categorySlug: categories.slug,
      fromPrice: min(productVariants.price),
      totalStock: sql<number>`coalesce(sum(${productVariants.stockQty}), 0)`,
      variantCount: sql<number>`count(${productVariants.id})`,
      size: sql<string | null>`min(${productVariants.size})`,
      imageUrl: firstImageUrl,
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
        options.categorySlug === null ? undefined : eq(categories.slug, options.categorySlug),
      ),
    )
    // categories.slug does not split a product: it has at most one category.
    .groupBy(products.id, products.slug, products.nameMn, products.createdAt, categories.slug)
    .orderBy(options.newestFirst ? desc(products.createdAt) : asc(products.createdAt))
    .limit(CATALOGUE_ROWS_MAX)
}

/**
 * One selectListingRows row. Spelled out rather than derived with
 * `typeof selectListingRows`: the server-function compiler counts that type
 * reference as a use, keeps the function in the browser bundle, and with it
 * the `db` import, which cannot load there. Passing the query's rows to
 * toProductCard and groupByCategory type-checks that the two still match.
 */
interface ListingRow {
  id: string
  slug: string
  name: string
  categorySlug: string | null
  fromPrice: number | null
  totalStock: number
  variantCount: number
  size: string | null
  imageUrl: string | null
}

/** A grouped listing row as the catalogue card shows it. */
function toProductCard(row: ListingRow): ProductCard {
  // The inner join on active variants guarantees at least one per row.
  assert(row.variantCount >= 1, 'a listed product has an active variant')
  assert(row.fromPrice !== null, 'a listed product has a lowest price')
  const fromPrice = Number(row.fromPrice)
  assert(Number.isSafeInteger(fromPrice), 'a product price is whole mungu')

  return {
    slug: row.slug,
    name: row.name,
    // A size is only worth showing when there is exactly one to show.
    size: row.variantCount === 1 ? row.size : null,
    fromPrice,
    totalStock: row.totalStock,
    variantCount: row.variantCount,
    imageUrl: row.imageUrl,
  }
}

export const listProducts = createServerFn({ method: 'GET' })
  .validator(listProductsInput)
  .handler(async ({ data }): Promise<ProductCard[]> => {
    // Both reads at once: search-as-you-type waits on this round trip.
    const [rows, matchedIds] = await Promise.all([
      selectListingRows({
        categorySlug: data.category ? data.category : null,
        newestFirst: data.sort === 'new',
      }),
      data.q ? matchingProductIds(data.q) : null,
    ])
    checkCatalogueBound(rows.length, 'listProducts')

    // Search matches are applied here, not as an `inArray` in the query: a
    // short query can match more products than one D1 statement may bind.
    const shown = matchedIds === null ? rows : rows.filter((row) => matchedIds.has(row.id))
    const ordered = data.sort === 'bestseller' ? await sortedByUnitsSold(shown) : shown

    return ordered.map(toProductCard)
  })

/**
 * Ids of the products a search term matches.
 *
 * Matches name (both languages), brand line, SKU and category, because people
 * search for all of them — "pomade", "UD-DP-100", "сахал" and "Featherweight"
 * are all things someone will type.
 *
 * Done in JS rather than SQL because SQLite (and so D1) only folds case for
 * ASCII: `LIKE` and `lower()` treat "Сахал" and "сахал" as different, which
 * makes a Mongolian shop's search useless. On Postgres this was ILIKE. The
 * catalogue is 22 products and will not pass 100 SKUs, so reading every
 * searchable string and matching here is cheaper than any index — and
 * toLocaleLowerCase gets Cyrillic right.
 */
async function matchingProductIds(query: string): Promise<Set<string>> {
  const needle = query.trim().toLocaleLowerCase()
  assert(needle.length > 0, 'a search term is not blank')

  const rows = await db
    .select({
      id: products.id,
      nameMn: products.nameMn,
      nameEn: products.nameEn,
      brandLine: products.brandLine,
      sku: productVariants.sku,
      categoryMn: categories.nameMn,
      categoryEn: categories.nameEn,
    })
    .from(products)
    .innerJoin(
      productVariants,
      and(eq(productVariants.productId, products.id), eq(productVariants.isActive, true)),
    )
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.status, 'active'))
    .limit(CATALOGUE_ROWS_MAX)
  checkCatalogueBound(rows.length, 'matchingProductIds')

  const ids = new Set<string>()
  for (const row of rows) {
    const haystack = [row.nameMn, row.nameEn, row.brandLine, row.sku, row.categoryMn, row.categoryEn]
    if (haystack.some((value) => value?.toLocaleLowerCase().includes(needle))) ids.add(row.id)
  }
  return ids
}

/**
 * `rows` reordered by units sold, most first. Array sort is stable, so ties
 * (including everything never sold) keep the order they came in.
 *
 * Units sold come from a separate query rather than another join. Joining
 * order_items into the listing query would multiply the rows its GROUP BY is
 * already aggregating, quietly inflating stock and variant counts. With a
 * catalogue this size a second round trip and a sort in memory is cheaper
 * than getting that subtle.
 */
async function sortedByUnitsSold<Row extends { slug: string }>(rows: Row[]): Promise<Row[]> {
  if (rows.length === 0) return []

  const unitsSold = sql<number>`coalesce(sum(${orderItems.qty}), 0)`
  const sold = await db
    .select({ slug: products.slug, units: unitsSold })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(orders.status, [...SOLD_ORDER_STATUSES]))
    .groupBy(products.slug)
    // Best sellers first, so a cut by the bound only loses the slowest.
    .orderBy(desc(unitsSold))
    .limit(CATALOGUE_ROWS_MAX)
  checkCatalogueBound(sold.length, 'sortedByUnitsSold')

  const unitsBySlug = new Map(sold.map((row) => [row.slug, row.units]))
  const sorted = [...rows].sort((a, b) => (unitsBySlug.get(b.slug) ?? 0) - (unitsBySlug.get(a.slug) ?? 0))
  assert(sorted.length === rows.length, 'sorting keeps every row')
  return sorted
}

/** A product the empty cart offers to add in one tap. */
export interface CartSuggestion {
  slug: string
  name: string
  size: string | null
  /** The one variant the + adds. */
  variantId: string
  /** In mungu. */
  price: number
  imageUrl: string | null
}

/**
 * Products for the empty cart drawer: best sellers first (units on paid
 * orders, as the 'bestseller' sort counts them), then the home page's own
 * order for anything that has not sold yet — so a new shop with no orders
 * suggests exactly what its home page features.
 *
 * Only products with a single active variant that is in stock. The drawer
 * adds with one tap and no picker, and for a product sold in several sizes or
 * colours that tap would have to guess which one the customer meant.
 */
export const listCartSuggestions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CartSuggestion[]> => {
    // One row per active variant, in the home page's order.
    const rows = await db
      .select({
        slug: products.slug,
        name: products.nameMn,
        variantId: productVariants.id,
        size: productVariants.size,
        price: productVariants.price,
        stockQty: productVariants.stockQty,
        imageUrl: firstImageUrl,
      })
      .from(products)
      .innerJoin(
        productVariants,
        and(eq(productVariants.productId, products.id), eq(productVariants.isActive, true)),
      )
      .where(eq(products.status, 'active'))
      .orderBy(asc(products.createdAt))
      .limit(CATALOGUE_ROWS_MAX)
    checkCatalogueBound(rows.length, 'listCartSuggestions')

    const ranked = await sortedByUnitsSold(singleVariantsInStock(rows))

    return ranked.slice(0, CART_SUGGESTION_LIMIT).map((row) => ({
      slug: row.slug,
      name: row.name,
      size: row.size,
      variantId: row.variantId,
      price: row.price,
      imageUrl: row.imageUrl,
    }))
  },
)

/** The variant rows whose product has no other active variant, and that have stock. */
function singleVariantsInStock<Row extends { slug: string; stockQty: number }>(rows: Row[]): Row[] {
  const variantCountBySlug = new Map<string, number>()
  for (const row of rows) {
    variantCountBySlug.set(row.slug, (variantCountBySlug.get(row.slug) ?? 0) + 1)
  }
  return rows.filter((row) => variantCountBySlug.get(row.slug) === 1 && row.stockQty > 0)
}

export interface ProductGroup {
  slug: string
  nameMn: string
  nameEn: string
  products: ProductCard[]
}

/**
 * Every active product, bucketed by category, for the left-nav "scroll to
 * group" listing — one query for the categories, one for every product with
 * its category slug attached, joined in memory rather than issuing a query
 * per category. Products with no category land in a trailing "Бусад" group
 * instead of vanishing from the listing.
 *
 * Renders every group's full product list today; if the catalogue grows past
 * what's comfortable to render at once, this is the seam to add per-group
 * pagination at — the shape (one array per category) already supports it
 * without a client-side rework.
 */
export const listGroupedProducts = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProductGroup[]> => {
    const [categoryRows, listingRows] = await Promise.all([
      selectCategories(),
      selectListingRows({ categorySlug: null, newestFirst: false }),
    ])
    checkCatalogueBound(categoryRows.length, 'listGroupedProducts categories')
    checkCatalogueBound(listingRows.length, 'listGroupedProducts products')

    return groupByCategory(categoryRows, listingRows)
  },
)

/** Category order first, empty categories left out, uncategorised last. */
function groupByCategory(
  categoryRows: Array<{ slug: string; nameMn: string; nameEn: string }>,
  listingRows: ListingRow[],
): ProductGroup[] {
  const cardsByCategory = new Map<string | null, ProductCard[]>()
  for (const row of listingRows) {
    const cards = cardsByCategory.get(row.categorySlug)
    if (cards) cards.push(toProductCard(row))
    else cardsByCategory.set(row.categorySlug, [toProductCard(row)])
  }

  const groups: ProductGroup[] = []
  for (const category of categoryRows) {
    const cards = cardsByCategory.get(category.slug)
    if (cards) groups.push({ ...category, products: cards })
  }

  const uncategorised = cardsByCategory.get(null)
  if (uncategorised) {
    groups.push({
      slug: '__other__',
      nameMn: 'Бусад',
      nameEn: 'Other',
      products: uncategorised,
    })
  }

  return groups
}

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
    assert(product.slug === data.slug, 'the product read is the one asked for')

    const [variants, images] = await Promise.all([
      db
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
        .limit(PRODUCT_VARIANTS_MAX),
      db
        .select({ url: productImages.url, alt: productImages.alt })
        .from(productImages)
        .where(eq(productImages.productId, product.id))
        .orderBy(asc(productImages.sortOrder))
        .limit(PRODUCT_IMAGES_MAX),
    ])

    // The id is internal; the browser gets slugs and variant ids only.
    const { id: _id, ...rest } = product
    return { ...rest, variants, images }
  })
