const STOPWORDS = new Set(['and', 'in', 'of', 'the', 'for', 'with'])

function initials(nameEn: string): string {
  const words = nameEn
    .trim()
    .split(/[\s&]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()))

  if (words.length === 0) return ''
  // A one-word name has no initials to take, so "Featherweight" becomes "FE"
  // rather than a blank middle segment.
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return words.map((w) => w[0]!.toUpperCase()).join('')
}

function sizeToken(size: string): string {
  const trimmed = size.trim()
  if (!trimmed) return ''
  // "30g" / "150ml" -> "30" / "150"; a non-numeric size like "Black" or
  // "Staple" is kept as a word instead.
  const numeric = trimmed.match(/^\d+/)
  if (numeric) return numeric[0]
  return trimmed.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/**
 * Best-effort SKU suggestion from the product name and variant size, e.g.
 * "Deluxe Pomade" + "30g" -> "UD-DP-30". "UD" is the shop's own catalogue
 * prefix — every product here is an Uppercut Deluxe item, see README.
 *
 * This is a starting point, not a rule: two products can still abbreviate to
 * the same initials, so the field stays editable and this only fills it in
 * when the admin hasn't typed something of their own.
 */
export function generateSku(nameEn: string, size: string): string {
  const base = initials(nameEn)
  if (!base) return ''
  const token = sizeToken(size)
  return token ? `UD-${base}-${token}` : `UD-${base}`
}

/**
 * Same suggestion, stepped past anything in `taken` — "UD-DP-30" becomes
 * "UD-DP-30-2" and so on.
 *
 * Two variants of one product routinely abbreviate to the same code: a colour
 * and a scent both leave the size blank, and a 30g tin and a 30ml tube both
 * reduce to "30". SKUs are unique across the whole catalogue, so without this
 * the form fills in a duplicate and the save fails on a Postgres constraint
 * the admin never saw coming.
 */
export function uniqueSku(
  nameEn: string,
  size: string,
  taken: Iterable<string>,
): string {
  const base = generateSku(nameEn, size)
  if (!base) return ''

  // Compared case-insensitively: "ud-dp-30" and "UD-DP-30" are the same code
  // to a person, whatever the unique index thinks.
  const used = new Set<string>()
  for (const value of taken) {
    const trimmed = value.trim()
    if (trimmed) used.add(trimmed.toUpperCase())
  }

  if (!used.has(base.toUpperCase())) return base

  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate.toUpperCase())) return candidate
  }

  // 99 collisions on one code means the suggestion is useless here; hand back
  // the plain one and let the admin write something better.
  return base
}
