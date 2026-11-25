import { assert } from '~/lib/assert'
import { D1_BOUND_PARAMETERS_MAX } from '~/db/limits'
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
 * Most distinct lines one cart may hold. Checkout reads them with one
 * `inArray` and settlement clears them with another, so this stays well under
 * D1's 100 bound parameters (db/limits.ts) — and no real basket gets near it.
 */
export const MAX_CART_LINES = 50
assert(MAX_CART_LINES < D1_BOUND_PARAMETERS_MAX, 'a cart\'s variant list must fit one D1 statement')

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
  /** Flat delivery fee, set by the shop in /admin/settings. */
  fee: Mungu
  /** Orders at or above this subtotal ship free. */
  freeThreshold: Mungu
}

export function computeTotals(
  lines: readonly PricedLine[],
  rates: ShippingRates,
): CartTotals {
  assert(Number.isInteger(rates.fee), 'the shipping fee is whole mungu')
  assert(rates.fee >= 0, 'the shipping fee is not negative')
  assert(Number.isInteger(rates.freeThreshold), 'the free-shipping threshold is whole mungu')
  assert(rates.freeThreshold >= 0, 'the free-shipping threshold is not negative')
  const subtotal = sumMungu(lines.map((l) => lineTotal(l.unitPrice, l.qty)))

  // An empty cart ships for nothing; charging delivery on nothing is a bug
  // that only shows up when someone empties their cart on the checkout page.
  const shippingFee =
    lines.length === 0 || subtotal >= rates.freeThreshold ? 0 : rates.fee

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
