import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { atomic } from '~/db/atomic'
import { db } from '~/db'
import { categories, orderItems, orders, productImages, productVariants, products } from '~/db/schema'

/**
 * The storefront's catalogue reads on a real local D1: what the home page,
 * the listing, search, the cart drawer and the product page are handed.
 *
 * Server functions are stood in for by a builder that parses the input with
 * the function's own zod schema and calls the handler, so what is under test
 * is the query and the shape it returns, not TanStack's transport.
 */
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: z.ZodType | null = null
    const builder = {
      validator(input: z.ZodType) {
        schema = input
        return builder
      },
      handler(run: (options: { data: unknown }) => unknown) {
        return (options?: { data?: unknown }) => run({ data: schema === null ? undefined : schema.parse(options?.data) })
      },
    }
    return builder
  },
}))

const { getProduct, listCartSuggestions, listCategories, listGroupedProducts, listProducts } = await import('./queries')

/**
 * The catalogue, oldest first:
 *   pomade   Pomades, two variants (30g, 100g), one image
 *   clay     Pomades, one variant, out of stock
 *   oil      Beard,   one variant ("Сахалны тос"), sold 5 on a paid order
 *   cape     no category, one variant
 *   draft    Pomades, draft (never listed)
 * plus an empty category that must not show up as a group.
 */
beforeAll(async () => {
  const pomades = crypto.randomUUID()
  const beard = crypto.randomUUID()
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute))
  const product = (slug: string, minute: number, categoryId: string | null, status: 'active' | 'draft' = 'active') => ({
    id: crypto.randomUUID(),
    slug,
    nameMn: `${slug} mn`,
    nameEn: `${slug} en`,
    categoryId,
    status,
    createdAt: at(minute),
  })
  const pomade = product('pomade', 1, pomades)
  const clay = product('clay', 2, pomades)
  const oil = { ...product('oil', 3, beard), nameMn: 'Сахалны тос' }
  const cape = product('cape', 4, null)
  const draft = product('draft', 5, pomades, 'draft')
  const oilVariant = crypto.randomUUID()
  const orderId = crypto.randomUUID()

  await atomic([
    db.insert(categories).values([
      { id: pomades, slug: 'pomades', nameMn: 'Помад', nameEn: 'Pomades', sortOrder: 1 },
      { id: beard, slug: 'beard', nameMn: 'Сахал', nameEn: 'Beard', sortOrder: 2 },
      { id: crypto.randomUUID(), slug: 'empty', nameMn: 'Хоосон', nameEn: 'Empty', sortOrder: 3 },
    ]),
    db.insert(products).values([pomade, clay, oil, cape, draft]),
    db.insert(productVariants).values([
      { productId: pomade.id, sku: 'UD-P-30', size: '30g', price: 3_000_000, stockQty: 2 },
      { productId: pomade.id, sku: 'UD-P-100', size: '100g', price: 5_000_000, stockQty: 3 },
      { productId: clay.id, sku: 'UD-C', size: '80g', price: 4_000_000, stockQty: 0 },
      { id: oilVariant, productId: oil.id, sku: 'UD-O', size: null, price: 2_000_000, stockQty: 9 },
      { productId: cape.id, sku: 'CAPE', size: null, price: 1_000_000, stockQty: 1 },
      { productId: draft.id, sku: 'UD-D', size: null, price: 1_000_000, stockQty: 1 },
    ]),
    db.insert(productImages).values([
      { productId: pomade.id, url: '/products/pomade-2.png', sortOrder: 2 },
      { productId: pomade.id, url: '/products/pomade-1.png', sortOrder: 1 },
    ]),
    db.insert(orders).values({
      id: orderId,
      orderNo: 'Q-1',
      status: 'paid',
      subtotal: 10_000_000,
      shippingFee: 0,
      total: 10_000_000,
      shippingAddressSnapshot: { name: null, phone: '99112233', email: null, address: 'UB' },
      contactPhone: '99112233',
      expiresAt: new Date(Date.now() + 3600e3),
      accessTokenHash: 'h',
    }),
    db.insert(orderItems).values({ orderId, variantId: oilVariant, skuSnapshot: 'UD-O', nameSnapshot: 'oil', unitPrice: 2_000_000, qty: 5 }),
  ])
})

const slugs = (cards: Array<{ slug: string }>) => cards.map((card) => card.slug)

describe('listProducts', () => {
  it('lists active products with a sellable variant, in catalogue order, as cards', async () => {
    // Goal: the card shape the UI renders directly, and that drafts are left out.
    const cards = await listProducts({ data: {} })
    expect(slugs(cards)).toEqual(['pomade', 'clay', 'oil', 'cape'])
    expect(cards[0]).toEqual({
      slug: 'pomade',
      name: 'pomade mn',
      size: null,
      fromPrice: 3_000_000,
      totalStock: 5,
      variantCount: 2,
      imageUrl: '/products/pomade-1.png',
    })
    expect(cards[1]).toMatchObject({ slug: 'clay', size: '80g', variantCount: 1, totalStock: 0, imageUrl: null })
  })

  it('sorts newest first and by units sold, keeping catalogue order for ties', async () => {
    expect(slugs(await listProducts({ data: { sort: 'new' } }))).toEqual(['cape', 'oil', 'clay', 'pomade'])
    expect(slugs(await listProducts({ data: { sort: 'bestseller' } }))).toEqual(['oil', 'pomade', 'clay', 'cape'])
  })

  it('filters by category, and search composes with it', async () => {
    expect(slugs(await listProducts({ data: { category: 'pomades' } }))).toEqual(['pomade', 'clay'])
    expect(slugs(await listProducts({ data: { category: 'pomades', q: 'clay' } }))).toEqual(['clay'])
  })

  it('searches names, SKUs and categories without regard to Cyrillic case', async () => {
    // Goal: the reason search runs in JS. SQLite would not match "САХАЛ".
    expect(slugs(await listProducts({ data: { q: 'САХАЛ' } }))).toEqual(['oil'])
    expect(slugs(await listProducts({ data: { q: 'ud-p-100' } }))).toEqual(['pomade'])
    expect(slugs(await listProducts({ data: { q: 'помад' } }))).toEqual(['pomade', 'clay'])
    expect(await listProducts({ data: { q: 'nothing like it' } })).toEqual([])
  })
})

describe('listGroupedProducts', () => {
  it('buckets by category in category order, drops empty ones, and puts the uncategorised last', async () => {
    const groups = await listGroupedProducts()
    expect(groups.map((group) => [group.slug, slugs(group.products)])).toEqual([
      ['pomades', ['pomade', 'clay']],
      ['beard', ['oil']],
      ['__other__', ['cape']],
    ])
  })
})

describe('listCategories', () => {
  it('lists every category in sort order', async () => {
    expect(slugs(await listCategories())).toEqual(['pomades', 'beard', 'empty'])
  })
})

describe('listCartSuggestions', () => {
  it('offers single-variant products in stock, best sellers first', async () => {
    // Goal: no product that would need a size picker, nothing out of stock.
    const suggestions = await listCartSuggestions()
    expect(slugs(suggestions)).toEqual(['oil', 'cape'])
    expect(suggestions[0]).toEqual({
      slug: 'oil',
      name: 'Сахалны тос',
      size: null,
      variantId: expect.any(String),
      price: 2_000_000,
      imageUrl: null,
    })
  })
})

describe('getProduct', () => {
  it('returns the product with variants by price and images in order, without its id', async () => {
    const product = await getProduct({ data: { slug: 'pomade' } })
    expect(product).not.toBeNull()
    expect(product).not.toHaveProperty('id')
    expect(product!.categorySlug).toBe('pomades')
    expect(product!.variants.map((variant) => variant.sku)).toEqual(['UD-P-30', 'UD-P-100'])
    expect(product!.images.map((image) => image.url)).toEqual(['/products/pomade-1.png', '/products/pomade-2.png'])
  })

  it('is null for a draft or unknown slug', async () => {
    expect(await getProduct({ data: { slug: 'draft' } })).toBeNull()
    expect(await getProduct({ data: { slug: 'missing' } })).toBeNull()
  })
})
