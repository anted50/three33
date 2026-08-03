import { lineTotal, sumMungu, type Mungu } from '~/lib/money'

/**
 * Cart arithmetic. Pure — no database, no request — because this decides what
 * the customer is charged, and it should be provable in a unit test rather
 * than inferred from a checkout run.
 *
 * Nothing here accepts a total from the client. Callers pass prices they just
 * read from product_variants; see lib/server/README.md rule 3.
 */

/**
 * Ulaanbaatar's nine districts. Anything else is a countryside address and
 * pays the higher flat rate. Stored as the canonical district values used by
 * the address form and by orders.shipping_address_snapshot.
 */
export const UB_DISTRICTS = [
  'Багануур',
  'Багахангай',
  'Баянгол',
  'Баянзүрх',
  'Налайх',
  'Сонгинохайрхан',
  'Сүхбаатар',
  'Хан-Уул',
  'Чингэлтэй',
] as const

export type UbDistrict = (typeof UB_DISTRICTS)[number]

export type ShippingZone = 'ub' | 'countryside'

export function zoneForDistrict(district: string): ShippingZone {
  return (UB_DISTRICTS as readonly string[]).includes(district)
    ? 'ub'
    : 'countryside'
}

export interface PricedLine {
  variantId: string
  /** Read from product_variants at pricing time, never from the browser. */
  unitPrice: Mungu
  qty: number
}

export interface CartTotals {
  subtotal: Mungu
  shippingFee: Mungu
  total: Mungu
}

export interface ShippingRates {
  ub: Mungu
  countryside: Mungu
  /** Orders at or above this subtotal ship free within UB. */
  freeUbThreshold: Mungu
}

export function computeTotals(
  lines: readonly PricedLine[],
  zone: ShippingZone,
  rates: ShippingRates,
): CartTotals {
  const subtotal = sumMungu(lines.map((l) => lineTotal(l.unitPrice, l.qty)))

  // An empty cart ships for nothing; charging delivery on nothing is a bug
  // that only shows up when someone empties their cart on the checkout page.
  const shippingFee =
    lines.length === 0
      ? 0
      : zone === 'ub' && subtotal >= rates.freeUbThreshold
        ? 0
        : rates[zone]

  return {
    subtotal,
    shippingFee,
    total: subtotal + shippingFee,
  }
}

/**
 * Clamps a requested quantity to what can actually be sold.
 * Returns 0 when the variant is out of stock, which callers treat as "remove".
 */
export function clampQty(requested: number, stockQty: number): number {
  if (!Number.isInteger(requested) || requested < 1) return 0
  return Math.min(requested, Math.max(stockQty, 0))
}
