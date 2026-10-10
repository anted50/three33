/**
 * How one closed POS sale's money splits between products and services.
 * Pure: unit tested.
 *
 *   products  the product lines (listed price × qty) — shop merchandise
 *   services  the free lines, minus the booking fee credited to them — that
 *             fee is counted on its own, when it was paid online, so it is
 *             never counted twice
 */
export function saleSplit(
  sale: { credit: number },
  lines: Array<{ unitAmount: number; qty: number; skuSnapshot: string | null }>,
) {
  let products = 0
  let units = 0
  let serviceLines = 0
  for (const l of lines) {
    const amount = l.unitAmount * l.qty
    if (l.skuSnapshot) {
      products += amount
      units += l.qty
    } else {
      serviceLines += amount
    }
  }
  return { products, units, services: serviceLines - sale.credit }
}

/** Adds `amount` into a keyed bucket, creating it on first use. */
export function addTo<K extends string>(
  map: Map<string, Record<K, number>>,
  key: string,
  field: K,
  amount: number,
  blank: () => Record<K, number>,
) {
  const entry = map.get(key) ?? blank()
  entry[field] += amount
  map.set(key, entry)
}
