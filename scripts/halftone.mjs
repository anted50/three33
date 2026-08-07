/**
 * Turns an image into a halftone dot matrix and writes it out as an SVG.
 *
 * The hero wants print-shop halftone rather than a photograph, and doing it as
 * vector output rather than a canvas pass at runtime buys three things: it is
 * resolution-independent on a phone and a 5K display alike, it costs no main
 * thread work on first paint, and it is a plain <img> so it cannot block
 * hydration. The cost is bytes, which is why the grid is deliberately coarse —
 * see COLS below.
 *
 * Two channels of the source are read, and they mean different things:
 *
 *   luminance → dot radius. Sized by sqrt, because a dot's *area* is what the
 *               eye integrates as tone; sizing radius linearly makes midtones
 *               read far too dark.
 *   redness   → dot colour. A pixel that is decisively more red than green or
 *               blue becomes an accent dot. This keeps the choice of what is
 *               red in the artwork, where it belongs, instead of hard-coding
 *               a bounding box here that any edit to the source would break.
 *
 * Usage:
 *   node scripts/halftone.mjs assets/hero-barber.svg public/hero-halftone.svg
 *   node scripts/halftone.mjs <in> <out> [--cols 120] [--gamma 1.0]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

const [, , input, output, ...flags] = process.argv

if (!input || !output) {
  console.error('usage: node scripts/halftone.mjs <in> <out> [--cols N] [--gamma N]')
  process.exit(1)
}

const flag = (name, fallback) => {
  const i = flags.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(flags[i + 1])
}

/**
 * Dots across. This is the whole size/quality dial: cells scale with the
 * square of it, and so does the output. 120 lands around 4–5k dots and ~25KB
 * gzipped, which is under what the photograph it replaces would have cost.
 */
const COLS = flag('cols', 120)

/** >1 darkens midtones, <1 lifts them. */
const GAMMA = flag('gamma', 1)

/** Below this the dot is not worth the bytes — it renders as a smudge. */
const MIN_RADIUS = 0.07

/** Dots touch at 0.5 in grid units; a hair under that keeps a printed feel. */
const MAX_RADIUS = 0.46

const BONE = '#f4f4f5'
const ACCENT = '#d81f26'

/**
 * Rasterise at 4x the grid and let sharp box-average down. Sampling the source
 * at grid resolution directly aliases badly on thin features — the razor's
 * blade dropped in and out of existence depending on the column count.
 */
const meta = await sharp(input, { density: 384 }).metadata()
const aspect = (meta.height ?? 1) / (meta.width ?? 1)
const rows = Math.max(1, Math.round(COLS * aspect))

const { data, info } = await sharp(input, { density: 384 })
  .resize(COLS * 4, rows * 4, { fit: 'fill' })
  .resize(COLS, rows, { fit: 'fill', kernel: 'lanczos3' })
  .flatten({ background: '#000000' })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const { channels } = info
const bone = []
const accent = []

for (let y = 0; y < rows; y++) {
  for (let x = 0; x < COLS; x++) {
    const i = (y * COLS + x) * channels
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // Rec. 709 luma: the eye weights green far above blue, and an unweighted
    // mean turns the red accent into a much bigger dot than it looks.
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    const radius = MAX_RADIUS * Math.sqrt(Math.min(1, Math.max(0, luma ** GAMMA)))

    if (radius < MIN_RADIUS) continue

    const dot = `<circle cx="${(x + 0.5).toFixed(1)}" cy="${(y + 0.5).toFixed(1)}" r="${radius.toFixed(2)}"/>`

    // Decisively red, not merely warm — a 1.4x margin over both other channels
    // keeps skin highlights out of the accent group.
    if (r > 60 && r > g * 1.4 && r > b * 1.4) accent.push(dot)
    else bone.push(dot)
  }
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS} ${rows}" ` +
  `width="${COLS}" height="${rows}" role="presentation">` +
  `<g fill="${BONE}">${bone.join('')}</g>` +
  `<g fill="${ACCENT}">${accent.join('')}</g>` +
  `</svg>\n`

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, svg)

console.log(
  `halftone: ${COLS}x${rows} grid, ${bone.length + accent.length} dots ` +
    `(${accent.length} accent), ${(svg.length / 1024).toFixed(0)}KB → ${output}`,
)
