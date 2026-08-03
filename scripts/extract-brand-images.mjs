/**
 * Extracts product packshots from the Uppercut Deluxe Product Bible PDF.
 *
 * Two things make this less trivial than "dump the JPEGs":
 *
 * 1. The packshots are CMYK JPEGs written by Adobe. Browsers cannot render
 *    CMYK JPEG at all, so each one is round-tripped through sharp to sRGB.
 * 2. Transparency lives in a *separate* grayscale image referenced as /SMask.
 *    Without it every packshot renders on a black rectangle, which looks
 *    broken on the white product tiles. The mask is inflated and joined back
 *    on as an alpha channel.
 *
 * Usage:
 *   node scripts/extract-brand-images.mjs <pdf> <outDir> [--sheets]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import sharp from 'sharp'

const [, , pdfPath, outDir, ...flags] = process.argv
const wantSheets = flags.includes('--sheets')

mkdirSync(outDir, { recursive: true })

const buf = readFileSync(pdfPath)
const latin = buf.toString('latin1')

/** Index every object's stream payload and dictionary, once. */
function indexObjects() {
  const objects = new Map()
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g
  let m

  while ((m = objRe.exec(latin)) !== null) {
    const start = m.index
    const sIdx = latin.indexOf('stream', start)
    if (sIdx === -1) continue

    /**
     * Plenty of objects carry no stream at all — colour spaces, for instance:
     *   255 0 obj [/Indexed 258 0 R 255 253 0 R] endobj
     * Without this check the "dictionary" runs past its own endobj and into the
     * next object, which silently shifts every object number by one and makes
     * /SMask references resolve to the wrong stream.
     */
    const eIdx = latin.indexOf('endobj', start)
    if (eIdx !== -1 && eIdx < sIdx) continue

    const dict = latin.slice(start, sIdx)
    if (dict.length > 4000) continue

    const len = Number((dict.match(/\/Length\s+(\d+)/) ?? [])[1] ?? 0)
    if (!len) continue

    let dataStart = sIdx + 'stream'.length
    if (latin[dataStart] === '\r') dataStart++
    if (latin[dataStart] === '\n') dataStart++

    objects.set(Number(m[1]), {
      dict,
      data: buf.subarray(dataStart, dataStart + len),
    })
  }

  return objects
}

const objects = indexObjects()

const num = (dict, key) =>
  Number((dict.match(new RegExp(`/${key}\\s+(\\d+)`)) ?? [])[1] ?? 0)

async function alphaFor(dict, width, height) {
  const ref = (dict.match(/\/SMask\s+(\d+)\s+\d+\s+R/) ?? [])[1]
  if (!ref) return null

  const mask = objects.get(Number(ref))
  if (!mask || !/\/FlateDecode/.test(mask.dict)) return null

  const mw = num(mask.dict, 'Width')
  const mh = num(mask.dict, 'Height')
  if (!mw || !mh) return null

  try {
    const raw = inflateSync(mask.data)
    if (raw.length < mw * mh) return null

    // The mask can be authored at a different resolution than the image.
    return await sharp(raw.subarray(0, mw * mh), {
      raw: { width: mw, height: mh, channels: 1 },
    })
      .resize(width, height, { fit: 'fill' })
      .toBuffer()
  } catch {
    return null
  }
}

const kept = []

for (const [id, obj] of objects) {
  if (!/\/Subtype\s*\/Image/.test(obj.dict)) continue
  if (!/\/DCTDecode/.test(obj.dict)) continue

  const width = num(obj.dict, 'Width')
  const height = num(obj.dict, 'Height')
  if (width < 600 || height < 600) continue

  const name = `obj${id}`

  try {
    // .png() is not optional: without an explicit output format sharp re-encodes
    // in the *input* format, handing back the CMYK JPEG it cannot then re-read.
    const base = await sharp(obj.data)
      .toColorspace('srgb')
      .removeAlpha()
      .png()
      .toBuffer()
    const alpha = await alphaFor(obj.dict, width, height)

    const image = alpha ? sharp(base).joinChannel(alpha) : sharp(base)

    // Square canvas on white: product tiles are 1:1, packshots are portrait.
    const out = await image
      .resize(1000, 1000, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 82 })
      .toBuffer()

    writeFileSync(join(outDir, `${name}.webp`), out)
    kept.push({ id, name, width, height, hasAlpha: Boolean(alpha) })
  } catch (error) {
    console.log(`  skip ${name}: ${error.message.split('\n')[0]}`)
  }
}

console.log(
  `converted ${kept.length} images (${kept.filter((k) => k.hasAlpha).length} had an alpha mask)`,
)

if (wantSheets) {
  const TILE = 300
  const COLS = 5
  const PER = 20

  for (let s = 0; s * PER < kept.length; s++) {
    const batch = kept.slice(s * PER, (s + 1) * PER)
    const rows = Math.ceil(batch.length / COLS)
    const composites = []

    for (let i = 0; i < batch.length; i++) {
      composites.push({
        input: await sharp(join(outDir, `${batch[i].name}.webp`))
          .resize(TILE, TILE, { fit: 'contain', background: '#ffffff' })
          .toBuffer(),
        left: (i % COLS) * TILE,
        top: Math.floor(i / COLS) * TILE,
      })
    }

    await sharp({
      create: {
        width: COLS * TILE,
        height: rows * TILE,
        channels: 3,
        background: '#dddddd',
      },
    })
      .composite(composites)
      .png()
      .toFile(join(outDir, `sheet${s + 1}.png`))

    console.log(`sheet${s + 1}: ${batch.map((b) => b.name).join(', ')}`)
  }
}
