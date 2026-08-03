/**
 * Seeds the real Uppercut Deluxe catalogue from packing list #SO0341156
 * (Three 33 barbershop, 24 June 2026). Idempotent — safe to re-run.
 *
 * Stock quantities are the actual quantities received.
 *
 * PRICES ARE PLACEHOLDERS. The packing list carries no pricing, so these are
 * plausible MNT retail figures, not the client's. Every one needs confirming
 * before launch — see PRICES_ARE_PLACEHOLDERS below.
 *
 * Not seeded: stickers, style-guide posters and the open/close sign from the
 * same shipment. Those are marketing collateral, not sellable stock.
 */
import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { tugrikToMungu } from '~/lib/money'
import { db } from '~/db'
import {
  categories,
  productImages,
  productVariants,
  products,
} from '~/db/schema'

export const PRICES_ARE_PLACEHOLDERS = true

const CATEGORIES = [
  { slug: 'styling', nameMn: 'Үс засалт', nameEn: 'Styling', sortOrder: 1 },
  { slug: 'sprays-tonics', nameMn: 'Шүршүүр, тоник', nameEn: 'Sprays & Tonics', sortOrder: 2 },
  { slug: 'hair-care', nameMn: 'Үсний арчилгаа', nameEn: 'Hair Care', sortOrder: 3 },
  { slug: 'beard-shave', nameMn: 'Сахал, сахлын хэрэгсэл', nameEn: 'Beard & Shave', sortOrder: 4 },
  { slug: 'skin', nameMn: 'Арьс арчилгаа', nameEn: 'Skin', sortOrder: 5 },
  { slug: 'accessories', nameMn: 'Дагалдах хэрэгсэл', nameEn: 'Accessories', sortOrder: 6 },
]

interface SeedVariant {
  sku: string
  size: string | null
  /** Tugrik. Converted to mungu on insert. */
  price: number
  stock: number
}

interface SeedProduct {
  slug: string
  name: string
  category: string
  brandLine: string | null
  descriptionMn: string
  descriptionEn: string
  variants: SeedVariant[]
}

const PRODUCTS: SeedProduct[] = [
  {
    slug: 'deluxe-pomade',
    name: 'Deluxe Pomade',
    category: 'styling',
    brandLine: 'Deluxe',
    descriptionMn:
      'Усан суурьтай, дунд зэргийн бэхэлгээтэй, өндөр гялбаатай помад. Өдрийн турш хэлбэрээ хадгална, усаар амархан угаагдана.',
    descriptionEn:
      'Water-based pomade with medium hold and high shine. Holds all day and washes out with water.',
    variants: [
      { sku: 'UD-DP-100', size: '100g', price: 85_000, stock: 96 },
      { sku: 'UD-DP-30', size: '30g', price: 45_000, stock: 48 },
    ],
  },
  {
    slug: 'matte-pomade',
    name: 'Matte Pomade',
    category: 'styling',
    brandLine: 'Deluxe',
    descriptionMn:
      'Гялбаагүй, натурал төгсгөлтэй помад. Дунд зэргийн бэхэлгээтэй, өдөр тутмын хэрэглээнд тохиромжтой.',
    descriptionEn:
      'Matte finish pomade with medium hold and a natural, shine-free look.',
    variants: [
      { sku: 'UD-MP-100', size: '100g', price: 85_000, stock: 96 },
      { sku: 'UD-MP-30', size: '30g', price: 45_000, stock: 48 },
    ],
  },
  {
    slug: 'featherweight',
    name: 'Featherweight',
    category: 'styling',
    brandLine: 'Featherweight',
    descriptionMn:
      'Хөнгөн, гялбаагүй нунтаг помад. Үсэнд эзэлхүүн нэмж, хүнд мэдрэмж үлдээхгүй.',
    descriptionEn:
      'Lightweight, low-shine styling product that adds volume without weighing hair down.',
    variants: [
      { sku: 'UD-FW-70', size: '70g', price: 89_000, stock: 48 },
      { sku: 'UD-FW-30', size: '30g', price: 45_000, stock: 48 },
    ],
  },
  {
    slug: 'clay',
    name: 'Clay',
    category: 'styling',
    brandLine: 'Clay',
    descriptionMn:
      'Байгалийн шаварт суурилсан, хүчтэй бэхэлгээтэй, гялбаагүй бүтээгдэхүүн. Богино болон дунд урттай үсэнд тохиромжтой.',
    descriptionEn:
      'Natural clay-based styling product. Strong hold, matte finish, ideal for short to medium hair.',
    variants: [
      { sku: 'UD-CL-70', size: '70g', price: 89_000, stock: 48 },
      { sku: 'UD-CL-25', size: '25g', price: 45_000, stock: 48 },
    ],
  },
  {
    slug: 'texture-cream',
    name: 'Texture Cream',
    category: 'styling',
    brandLine: null,
    descriptionMn:
      'Зөөлөн бэхэлгээтэй, бүтэц өгөх крем. Байгалийн харагдах байдал өгнө.',
    descriptionEn:
      'Light-hold cream that adds texture and definition with a natural finish.',
    variants: [{ sku: 'UD-TC-100', size: '100g', price: 85_000, stock: 48 }],
  },
  {
    slug: 'styling-powder',
    name: 'Styling Powder',
    category: 'styling',
    brandLine: null,
    descriptionMn:
      'Үндсэнд нь шууд түрхэх нунтаг. Эзэлхүүн, бүтэц агшин зуур нэмнэ.',
    descriptionEn:
      'Powder applied at the roots for instant volume and texture.',
    variants: [{ sku: 'UD-SP-20', size: '20g', price: 75_000, stock: 48 }],
  },
  {
    slug: 'easy-hold',
    name: 'Easy Hold',
    category: 'styling',
    brandLine: null,
    descriptionMn: 'Зөөлөн, уян бэхэлгээтэй. Өдөр тутмын энгийн засалтанд.',
    descriptionEn: 'Soft, flexible hold for relaxed everyday styling.',
    variants: [{ sku: 'UD-EH-30', size: '30g', price: 45_000, stock: 48 }],
  },
  {
    slug: 'monster-hold',
    name: 'Monster Hold',
    category: 'styling',
    brandLine: null,
    descriptionMn:
      'Хамгийн хүчтэй бэхэлгээтэй. Удаан хугацаанд хэлбэрээ хадгална.',
    descriptionEn: 'The firmest hold in the range, for styles that must not move.',
    variants: [{ sku: 'UD-MH-30', size: '30g', price: 45_000, stock: 48 }],
  },
  {
    slug: 'salt-spray',
    name: 'Salt Spray',
    category: 'sprays-tonics',
    brandLine: null,
    descriptionMn:
      'Далайн давсны шүршүүр. Байгалийн эрчилсэн бүтэц, эзэлхүүн өгнө.',
    descriptionEn: 'Sea-salt spray for natural, beachy texture and volume.',
    variants: [{ sku: 'UD-SS-150', size: '150ml', price: 79_000, stock: 48 }],
  },
  {
    slug: 'foam-tonic',
    name: 'Foam Tonic',
    category: 'sprays-tonics',
    brandLine: null,
    descriptionMn:
      'Хөөсөн тоник. Үсийг зөөлрүүлж, засалтанд бэлтгэнэ.',
    descriptionEn: 'Foaming tonic that softens hair and preps it for styling.',
    variants: [{ sku: 'UD-FT-150', size: '150ml', price: 79_000, stock: 48 }],
  },
  {
    slug: 'clay-spray',
    name: 'Clay Spray',
    category: 'sprays-tonics',
    brandLine: 'Clay',
    descriptionMn:
      'Шавартай шүршүүр. Гялбаагүй бүтэц, дунд бэхэлгээ хосолсон.',
    descriptionEn: 'Clay-infused spray combining matte texture with medium hold.',
    variants: [{ sku: 'UD-CS-150', size: '150ml', price: 79_000, stock: 48 }],
  },
  {
    slug: 'control-cream',
    name: 'Control Cream',
    category: 'sprays-tonics',
    brandLine: null,
    descriptionMn:
      'Буржгар, тэсрэлттэй үсийг номхруулах крем. Зөөлөн бэхэлгээтэй.',
    descriptionEn: 'Smoothing cream that tames frizz with a light hold.',
    variants: [{ sku: 'UD-CC-120', size: '120ml', price: 82_000, stock: 48 }],
  },
  {
    slug: 'strength-restore-shampoo',
    name: 'Strength & Restore Shampoo',
    category: 'hair-care',
    brandLine: 'Strength & Restore',
    descriptionMn:
      'Өдөр тутмын хэрэглээний шампунь. Үсийг цэвэрлэж, бэхжүүлнэ.',
    descriptionEn: 'Daily shampoo that cleanses and strengthens.',
    variants: [{ sku: 'UD-SR-SH-240', size: '240ml', price: 72_000, stock: 24 }],
  },
  {
    slug: 'strength-restore-conditioner',
    name: 'Strength & Restore Conditioner',
    category: 'hair-care',
    brandLine: 'Strength & Restore',
    descriptionMn: 'Үсийг зөөлрүүлж, чийгшүүлэх кондиционер.',
    descriptionEn: 'Conditioner that softens and hydrates.',
    variants: [{ sku: 'UD-SR-CO-240', size: '240ml', price: 72_000, stock: 12 }],
  },
  {
    slug: 'clear-scalp',
    name: 'Clear Scalp',
    category: 'hair-care',
    brandLine: null,
    descriptionMn: 'Толгойн арьсны хуйхыг цэвэрлэж, тэнцвэржүүлэх шампунь.',
    descriptionEn: 'Clarifying shampoo that cleanses and balances the scalp.',
    variants: [{ sku: 'UD-CSC-240', size: '240ml', price: 72_000, stock: 24 }],
  },
  {
    slug: '3-in-1',
    name: '3 in 1',
    category: 'hair-care',
    brandLine: null,
    descriptionMn: 'Үс, бие, нүүрэнд зориулсан гурван үйлчилгээт угаагч.',
    descriptionEn: 'Hair, body and face wash in one.',
    variants: [{ sku: 'UD-3N1-240', size: '240ml', price: 68_000, stock: 24 }],
  },
  {
    slug: 'detox-degrease',
    name: 'Detox & Degrease',
    category: 'hair-care',
    brandLine: null,
    descriptionMn:
      'Гүн цэвэрлэгээний шампунь. Тос, үлдэгдлийг бүрэн зайлуулна.',
    descriptionEn:
      'Deep-cleansing shampoo that strips oil and product build-up.',
    variants: [{ sku: 'UD-DD-240', size: '240ml', price: 72_000, stock: 12 }],
  },
  {
    slug: 'beard-oil',
    name: 'Beard Oil',
    category: 'beard-shave',
    brandLine: null,
    descriptionMn: 'Сахлыг зөөлрүүлж, доорх арьсыг тэжээх тос.',
    descriptionEn: 'Softens the beard and conditions the skin beneath.',
    variants: [{ sku: 'UD-BO-30', size: '30ml', price: 69_000, stock: 72 }],
  },
  {
    slug: 'beard-balm',
    name: 'Beard Balm',
    category: 'beard-shave',
    brandLine: null,
    descriptionMn: 'Сахлыг хэлбэржүүлж, чийгшүүлэх бальзам.',
    descriptionEn: 'Balm that shapes and hydrates the beard.',
    variants: [{ sku: 'UD-BB-100', size: '100ml', price: 75_000, stock: 48 }],
  },
  {
    slug: 'shave-cream',
    name: 'Shave Cream',
    category: 'beard-shave',
    brandLine: null,
    descriptionMn: 'Гөлгөр, ойрхон сахлах боломж олгох крем.',
    descriptionEn: 'Cream for a smooth, close shave.',
    variants: [{ sku: 'UD-SHC-120', size: '120g', price: 75_000, stock: 6 }],
  },
  {
    slug: 'hydrating-moisturiser',
    name: 'Hydrating Moisturiser',
    category: 'skin',
    brandLine: null,
    descriptionMn: 'Өдөр тутмын чийгшүүлэгч. Хөнгөн, түргэн шингэнэ.',
    descriptionEn: 'Lightweight daily moisturiser that absorbs quickly.',
    variants: [{ sku: 'UD-HM-120', size: '120ml', price: 89_000, stock: 12 }],
  },
  {
    slug: 'barber-cape',
    name: 'Barber Cape',
    category: 'accessories',
    brandLine: null,
    descriptionMn: 'Мэргэжлийн үсчний нөмрөг. Гурван загвартай.',
    descriptionEn: 'Professional barber cape. Three designs.',
    variants: [
      { sku: 'UD-CAPE-STAPLE', size: 'Staple', price: 145_000, stock: 3 },
      { sku: 'UD-CAPE-BLACK', size: 'Black', price: 145_000, stock: 3 },
      { sku: 'UD-CAPE-UNEXPECTED', size: 'Unexpected', price: 145_000, stock: 3 },
    ],
  },
]

async function main() {
  await db
    .insert(categories)
    .values(CATEGORIES)
    .onConflictDoNothing({ target: categories.slug })

  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
  const categoryIdBySlug = new Map(categoryRows.map((c) => [c.slug, c.id]))

  let productCount = 0
  let variantCount = 0
  let imageCount = 0

  for (const product of PRODUCTS) {
    const categoryId = categoryIdBySlug.get(product.category)
    if (!categoryId) {
      throw new Error(`Unknown category "${product.category}"`)
    }

    await db
      .insert(products)
      .values({
        slug: product.slug,
        nameMn: product.name, // brand names are not translated
        nameEn: product.name,
        descriptionMn: product.descriptionMn,
        descriptionEn: product.descriptionEn,
        categoryId,
        brandLine: product.brandLine,
        status: 'active',
      })
      .onConflictDoNothing({ target: products.slug })

    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, product.slug))
      .limit(1)

    if (!row) throw new Error(`Failed to load product ${product.slug}`)
    productCount++

    for (const variant of product.variants) {
      await db
        .insert(productVariants)
        .values({
          productId: row.id,
          sku: variant.sku,
          size: variant.size,
          price: tugrikToMungu(variant.price),
          stockQty: variant.stock,
          isActive: true,
        })
        .onConflictDoNothing({ target: productVariants.sku })
      variantCount++
    }

    /**
     * Packshots extracted from the Product Bible by
     * scripts/extract-brand-images.mjs. Products without one fall back to the
     * text placeholder in the UI — see scripts/map-brand-images.mjs MISSING.
     *
     * Served from public/ for now; Phase 1 moves uploads to MinIO/S3.
     */
    const imagePath = `/products/${product.slug}.webp`
    if (existsSync(`public${imagePath}`)) {
      await db
        .insert(productImages)
        .values({
          productId: row.id,
          url: imagePath,
          alt: product.name,
          sortOrder: 0,
        })
        .onConflictDoNothing()
      imageCount++
    }
  }

  console.log(
    `seed: ${CATEGORIES.length} categories, ${productCount} products, ${variantCount} variants, ${imageCount} images`,
  )
  console.log(
    `seed: ${productCount - imageCount} products still have no packshot`,
  )
  if (PRICES_ARE_PLACEHOLDERS) {
    console.log('seed: WARNING - prices are placeholders, confirm with client')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('seed: failed', error)
    process.exit(1)
  })
