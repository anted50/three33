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
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
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
