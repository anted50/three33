/**
 * Development seed. Idempotent — safe to re-run.
 * Real Uppercut SKUs and prices get filled in during Phase 1 once the client
 * confirms the catalogue; the shapes below are placeholders with correct units.
 */
import { tugrikToMungu } from '~/lib/money'
import { db } from '~/db'
import { categories, productVariants, products } from '~/db/schema'

const CATEGORIES = [
  { slug: 'pomade', nameMn: 'Помад', nameEn: 'Pomade', sortOrder: 1 },
  { slug: 'clay', nameMn: 'Шавар', nameEn: 'Clay', sortOrder: 2 },
  { slug: 'styling', nameMn: 'Засал', nameEn: 'Styling', sortOrder: 3 },
  { slug: 'beard', nameMn: 'Сахал', nameEn: 'Beard', sortOrder: 4 },
]

async function main() {
  const inserted = await db
    .insert(categories)
    .values(CATEGORIES)
    .onConflictDoNothing({ target: categories.slug })
    .returning({ id: categories.id, slug: categories.slug })

  const bySlug = new Map(inserted.map((c) => [c.slug, c.id]))
  const pomadeId = bySlug.get('pomade')

  if (pomadeId) {
    const [product] = await db
      .insert(products)
      .values({
        slug: 'deluxe-pomade',
        nameMn: 'Deluxe Pomade',
        nameEn: 'Deluxe Pomade',
        descriptionMn: 'Дунд зэргийн бэхэлгээтэй, өндөр гялбаатай усан суурьтай помад.',
        descriptionEn: 'Water-based pomade, medium hold, high shine.',
        categoryId: pomadeId,
        brandLine: 'Deluxe',
        status: 'active',
      })
      .onConflictDoNothing({ target: products.slug })
      .returning({ id: products.id })

    if (product) {
      await db
        .insert(productVariants)
        .values([
          {
            productId: product.id,
            sku: 'UD-DP-70',
            sizeMl: 70,
            price: tugrikToMungu(45_000),
            stockQty: 25,
          },
          {
            productId: product.id,
            sku: 'UD-DP-100',
            sizeMl: 100,
            price: tugrikToMungu(59_000),
            stockQty: 12,
          },
        ])
        .onConflictDoNothing({ target: productVariants.sku })
    }
  }

  console.log('seed: done')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('seed: failed', error)
    process.exit(1)
  })
