/**
 * The density ramp src/assets/hero-ascii.txt was resampled onto, heaviest
 * first. Index is ink coverage, so neighbouring entries fill their cell by
 * about the same amount, and the position of a character in this string is the
 * only thing that says how dark it is.
 */
export const RAMP =
  '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. '

const LAST = RAMP.length - 1

const RAMP_INDEX = new Map([...RAMP].map((char, i) => [char, i]))

export function isRampChar(char: string): boolean {
  return RAMP_INDEX.has(char)
}

/** Ink coverage of a character, 0 (blank) to 1 (solid). */
export function densityOf(char: string): number {
  const i = RAMP_INDEX.get(char)
  return i === undefined ? 0 : 1 - i / LAST
}

/** The character on the ramp closest to a given ink coverage. */
export function glyphFor(density: number): string {
  const level = Math.round((1 - Math.min(1, Math.max(0, density))) * LAST)
  return RAMP[level] ?? ' '
}

/**
 * A cell's neighbour on the ramp, one step lighter or one step heavier.
 *
 * Used by the hero's flicker. One step is a fraction of a tone, so what moves
 * is texture rather than structure — a larger jump punches a hole in the
 * shading and reads as a rendering fault.
 */
export function neighbour(char: string, rand: () => number): string | undefined {
  const i = RAMP_INDEX.get(char)
  if (i === undefined) return undefined

  const step = rand() < 0.5 ? -1 : 1
  // Clamped by reflection rather than by giving up, so the two ends of the ramp
  // flicker at the same rate as the middle instead of half as often.
  const j = i + step < 0 || i + step > LAST ? i - step : i + step
  return RAMP[j]
}

/**
 * mulberry32. Small, fast, and — the reason it is here rather than
 * Math.random — seedable, so a given band width always generates the same fill.
 * Without that, every resize would reshuffle the whole left half of the hero.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Per-row ink coverage along the left edge of the art, smoothed vertically.
 *
 * This is what ties the generated fill to the photograph instead of laying an
 * unrelated pattern beside it: the fill for a row starts from the tone the
 * picture actually has where the two meet, so a row that ends in bright wall
 * continues as bright wall and a row that ends in the barber's shoulder
 * continues dark.
 *
 * Smoothed because a single column is noisy, and unsmoothed tones striped the
 * fill into 100 visibly independent rows.
 */
export function edgeTones(lines: ReadonlyArray<string>, sample = 16): number[] {
  const raw = lines.map((line) => {
    const cells = [...line.slice(0, sample)]
    if (cells.length === 0) return 0
    return cells.reduce((sum, char) => sum + densityOf(char), 0) / cells.length
  })

  return raw.map((_, y) => {
    let sum = 0
    let n = 0
    for (let i = y - 2; i <= y + 2; i++) {
      const v = raw[i]
      if (v === undefined) continue
      sum += v
      n++
    }
    return n === 0 ? 0 : sum / n
  })
}

/**
 * Per-column ink coverage along the top or bottom edge of the art, smoothed
 * horizontally — the same idea as edgeTones, transposed. Used to fill above
 * or below the picture instead of beside it, which is what a phone needs:
 * fit by width instead of by height (see app.css), the picture comes out
 * shorter than the band instead of narrower.
 */
export function edgeTonesRow(
  lines: ReadonlyArray<string>,
  edge: 'top' | 'bottom',
  sample = 16,
): number[] {
  const sampled = edge === 'top' ? lines.slice(0, sample) : lines.slice(-sample)
  const cols = Math.max(0, ...lines.map((line) => line.length))

  const raw = Array.from({ length: cols }, (_, x) => {
    const cells = sampled.map((line) => line[x]).filter((c) => c !== undefined)
    if (cells.length === 0) return 0
    return cells.reduce((sum, char) => sum + densityOf(char), 0) / cells.length
  })

  return raw.map((_, x) => {
    let sum = 0
    let n = 0
    for (let i = x - 2; i <= x + 2; i++) {
      const v = raw[i]
      if (v === undefined) continue
      sum += v
      n++
    }
    return n === 0 ? 0 : sum / n
  })
}

/**
 * Generates `rows` rows of ASCII to sit above or below the art — buildFill,
 * transposed. Row 0 is farthest from the picture (near blank); the last row
 * sits flush against it, at full tone. Callers reverse that order themselves
 * when appending below the art, so the strong end lands next to the picture
 * either way — see components/hero-ascii.
 */
export function buildRowFill(
  tones: ReadonlyArray<number>,
  rows: number,
  rand: () => number,
): string[] {
  if (rows <= 0) return []

  const out: string[] = []
  for (let y = 0; y < rows; y++) {
    const reach = Math.pow((y + 1) / rows, 1.7)
    let line = ''
    for (const tone of tones) {
      const density = tone * reach * (0.55 + rand() * 0.9)
      line += density < 0.05 ? ' ' : glyphFor(density)
    }
    out.push(line)
  }
  return out
}

/**
 * Generates `cols` columns of ASCII to sit to the left of the art, one string
 * per row.
 *
 * The fill is not decoration for its own sake — it exists because fitting the
 * whole picture into the band by height leaves the band wider than the picture,
 * and the alternative to filling that space was cropping the photograph
 * vertically to cover it.
 *
 * Two things make it read as the same surface rather than as a texture parked
 * next to a photo: it is drawn from the same ramp, and each row starts from the
 * tone of the picture's own left edge. It then falls away to the left, so the
 * band dissolves into paper instead of ending on a wall of characters.
 */
export function buildFill(
  tones: ReadonlyArray<number>,
  cols: number,
  rand: () => number,
): string[] {
  if (cols <= 0) return tones.map(() => '')

  return tones.map((tone) => {
    let line = ''

    for (let x = 0; x < cols; x++) {
      /*
       * 0 at the far left, 1 where the fill meets the art. Raised to a power
       * so the decay is slow near the picture and steep out at the edge —
       * linear made the fill read as a wedge with a visible straight edge to
       * it, which is exactly the hard boundary it is supposed to avoid.
       */
      const reach = Math.pow((x + 1) / cols, 1.7)

      // Wide jitter. The picture's own noise is what stops a gradient of
      // characters looking like a gradient, and the fill needs the same.
      const density = tone * reach * (0.55 + rand() * 0.9)

      // Below this the ramp only has punctuation left, which at these sizes is
      // indistinguishable from blank and costs a glyph to paint.
      line += density < 0.05 ? ' ' : glyphFor(density)
    }

    return line
  })
}
