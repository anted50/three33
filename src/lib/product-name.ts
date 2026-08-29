/**
 * The size to print after a product name, or '' when it would repeat itself.
 *
 * Products split out of a multi-size parent are named after the size they
 * carry ("Monster Hold 30g"), so appending the variant size again would read
 * "Monster Hold 30g 30g". Shared by every customer-facing place that prints a
 * name and a size together — the catalogue card and the cart line.
 */
export function sizeSuffix(name: string, size: string | null | undefined) {
  const trimmed = size?.trim()
  if (!trimmed) return ''

  return name.trim().toLowerCase().endsWith(trimmed.toLowerCase())
    ? ''
    : ` ${trimmed}`
}
