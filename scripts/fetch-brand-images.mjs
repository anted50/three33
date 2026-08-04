/**
 * Downloads product packshots from Uppercut Deluxe's own Shopify store and
 * normalises them to match the ones extracted from the Product Bible.
 *
 * WHY DOWNLOAD RATHER THAN HOTLINK
 *
 * Pointing <img src> at their CDN looks free but is fragile and impolite:
 *
 *  - Shopify image URLs carry a `?v=` cache-buster that changes whenever the
 *    brand re-uploads a photo. Old URLs stop resolving, and the failure shows
 *    up as a broken product page on our storefront, at their timing.
 *  - A discontinued or renamed product 404s, silently, in production.
 *  - It spends the brand's bandwidth without asking. The distributor
 *    relationship is worth more than the 40 KB an image costs us.
 *  - Every product tile would need a DNS lookup and TLS handshake to a second
 *    origin before it could paint.
 *
 * Self-hosting costs nothing here: the 13 existing packshots total ~520 KB.
 *
 * LICENSING
 *
 * These are the brand's product photographs, used by their authorised
 * Mongolian distributor to sell those exact products — normal practice, and
 * usually encouraged. Still worth confirming against the distribution
 * agreement. See docs/asset-request.md.
 *
 * Usage:
 *   node scripts/fetch-brand-images.mjs [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const CATALOGUE = 'https://uppercutdeluxe.com/products.json?limit=250'
const OUT = 'public/products'
const force = process.argv.includes('--force')

/**
 * Our slug -> their Shopify handle.
 *
 * Explicit rather than fuzzy-matched on title: "Clay" also matches "Clay Twin
 * Pack", "Clay - Midi" and "Stock Up Bundle - Clay", and a bundle photo on a
 * single-product page is exactly the kind of wrong-but-plausible image nobody
 * notices until a customer does.
 */
const HANDLES = {
  clay: 'clay',
  'clay-spray': 'clay-spray',
  'control-cream': 'control-cream',
  'texture-cream': 'texture-cream',
  'salt-spray': 'salt-spray',
  'foam-tonic': 'foam-tonic',
  'beard-oil': 'beard-oil',
  'beard-balm': 'beard-balm',
  'barber-cape': 'barber-cape-black',
}

mkdirSync(OUT, { recursive: true })

const response = await fetch(CATALOGUE)
if (!response.ok) {
  console.error(`catalogue fetch failed: ${response.status}`)
  process.exit(1)
}

const { products } = await response.json()
const byHandle = new Map(products.map((p) => [p.handle, p]))

let written = 0
let skipped = 0

for (const [slug, handle] of Object.entries(HANDLES)) {
  const target = join(OUT, `${slug}.webp`)

  if (existsSync(target) && !force) {
    console.log(`  skip ${slug} (already have it)`)
    skipped++
    continue
  }

  const product = byHandle.get(handle)
  if (!product) {
    console.log(`  MISS ${slug}: no product with handle "${handle}"`)
    continue
  }

  const image = product.images?.[0]
  if (!image?.src) {
    console.log(`  MISS ${slug}: product has no images`)
    continue
  }

  // Shopify resizes on demand; ask for more than we need so the downscale to
  // 1000px stays sharp.
  const url = `${image.src.split('?')[0]}?width=1600`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.log(`  MISS ${slug}: ${res.status} for ${url}`)
      continue
    }

    const buf = Buffer.from(await res.arrayBuffer())

    // Same pipeline as the Product Bible extraction, so the two sources sit
    // side by side on the grid without one looking pasted in.
    const out = await sharp(buf)
      .resize(1000, 1000, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 82 })
      .toBuffer()

    writeFileSync(target, out)
    console.log(`  ok   ${slug} <- ${product.title} (${Math.round(out.length / 1024)} KB)`)
    written++
  } catch (error) {
    console.log(`  FAIL ${slug}: ${error.message}`)
  }
}

console.log(`\nwrote ${written}, skipped ${skipped}`)
