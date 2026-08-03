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
 * Known gaps. These packshots are CMYK JPEGs whose transparency lives in a
 * separate /SMask stream that the extractor could not decode, so they come out
 * on a black rectangle. Needs either a fix to the mask handling or plain
 * product photography from the client.
 */
export const MISSING = [
  'clay',
  'clay-spray',
  'control-cream',
  'texture-cream',
  'salt-spray',
  'foam-tonic',
  'beard-oil',
  'beard-balm',
  'barber-cape',
]

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
