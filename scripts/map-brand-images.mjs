/**
 * Copies identified packshots out of the extraction directory into public/
 * under product slugs.
 *
 * The mapping is by eye, from contact sheets — the Product Bible has no
 * machine-readable link between an image XObject and a product name. Each entry
 * below was visually confirmed against its label.
 *
 * Products absent from this map render the text placeholder instead. That is
 * deliberate: a wrong packshot on a product page is worse than no packshot.
 *
 * Usage: node scripts/map-brand-images.mjs <extractDir>
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** slug -> object id in the Product Bible PDF. */
export const IMAGE_MAP = {
  'deluxe-pomade': 'obj271',
  featherweight: 'obj278',
  'monster-hold': 'obj279',
  'matte-pomade': 'obj281',
  'easy-hold': 'obj284',
  'styling-powder': 'obj288',
  'strength-restore-shampoo': 'obj159',
  'strength-restore-conditioner': 'obj158',
  'clear-scalp': 'obj164',
  '3-in-1': 'obj163',
  'detox-degrease': 'obj157',
  'hydrating-moisturiser': 'obj170',
  'shave-cream': 'obj175',
}

/**
 * Empty, and kept deliberately.
 *
 * Nine products could not be recovered from the Product Bible PDF — their
 * packshots are CMYK JPEGs whose transparency lives in a /SMask stream the
 * extractor cannot decode, so they came out on a black rectangle. They are now
 * covered by scripts/fetch-brand-images.mjs, which pulls them from the brand's
 * own Shopify store instead.
 *
 * Anything added here renders the text placeholder rather than a wrong photo.
 */
export const MISSING = []

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/map-brand-images.mjs <extractDir>')
  process.exit(1)
}

const dest = 'public/products'
mkdirSync(dest, { recursive: true })

let copied = 0
for (const [slug, obj] of Object.entries(IMAGE_MAP)) {
  const from = join(src, `${obj}.webp`)
  if (!existsSync(from)) {
    console.log(`  missing source for ${slug}: ${from}`)
    continue
  }
  copyFileSync(from, join(dest, `${slug}.webp`))
  copied++
}

console.log(`copied ${copied}/${Object.keys(IMAGE_MAP).length} packshots`)
console.log(`still without imagery (${MISSING.length}): ${MISSING.join(', ')}`)
