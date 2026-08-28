import type { Mungu } from '~/lib/money'

/**
 * "Is this the same purchase as the one already waiting to be paid?"
 *
 * Checkout reuses a live invoice rather than minting a second one, so it needs
 * a cheap, order-insensitive way to compare what is in the cart now against
 * what an existing pending order froze. That comparison is the whole anti-spam
 * story — a refresh, a double-tap on the pay button and a back-button
 * resubmission all have to land on the same invoice — so it lives here as a
 * pure function rather than as a query nobody can test.
 *
 * The total is part of the fingerprint on purpose. Identical lines at a changed
 * price are NOT the same basket: the customer must be sent to an invoice for
 * the amount they were just shown.
 */

export interface FingerprintLine {
  variantId: string
  qty: number
}

/**
 * Sorted, so cart line order — which changes as items are removed and re-added
 * — cannot make an unchanged basket look different.
 */
export function basketFingerprint(
  lines: readonly FingerprintLine[],
  total: Mungu,
): string {
  const parts = lines
    .map((line) => `${line.variantId}:${line.qty}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  return `${parts.join('|')}#${total}`
}

export function sameBasket(a: string, b: string): boolean {
  return a === b
}
