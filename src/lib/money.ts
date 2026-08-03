/**
 * Money in this codebase is always an integer count of *mungu* (мөнгө),
 * the 1/100 subunit of the tugrik (₮). 1 ₮ = 100 mungu.
 *
 * Rules:
 *   - Every amount in the DB, in server functions, and on the wire is mungu.
 *   - Never a float. Never `parseFloat` on a price.
 *   - Conversion happens at exactly two boundaries: display (formatMnt) and
 *     the QPay API (toQpayAmount / fromQpayAmount).
 */

/** Branded so a raw number can't be passed where mungu is expected by mistake. */
export type Mungu = number

export const MUNGU_PER_TUGRIK = 100

/** 1500 ₮ -> 150000 mungu. Rejects fractional mungu. */
export function tugrikToMungu(tugrik: number): Mungu {
  const mungu = Math.round(tugrik * MUNGU_PER_TUGRIK)
  if (!Number.isFinite(mungu)) {
    throw new RangeError(`tugrikToMungu: not a finite amount: ${tugrik}`)
  }
  return mungu
}

/** 150000 mungu -> 1500. Lossy by design; only for display and QPay. */
export function munguToTugrik(mungu: Mungu): number {
  assertMungu(mungu)
  return mungu / MUNGU_PER_TUGRIK
}

export function assertMungu(value: unknown): asserts value is Mungu {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`Expected an integer mungu amount, got: ${String(value)}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Mungu amount exceeds safe integer range: ${value}`)
  }
}

/**
 * Display format, Mongolian convention: "12,500₮" — space-free suffix, comma
 * thousands separators. Sub-tugrik remainders are not shown; prices in this
 * catalogue are whole tugrik, and a stray "₮12,500.34" would look like a bug.
 */
export function formatMnt(mungu: Mungu): string {
  assertMungu(mungu)
  const tugrik = Math.round(munguToTugrik(mungu))
  return `${tugrik.toLocaleString('en-US')}₮`
}

/**
 * QPay's `amount` field is in tugrik, not mungu. This is the only place that
 * conversion is allowed to happen on the way out.
 */
export function toQpayAmount(mungu: Mungu): number {
  assertMungu(mungu)
  if (mungu % MUNGU_PER_TUGRIK !== 0) {
    throw new RangeError(
      `Cannot invoice a sub-tugrik amount via QPay: ${mungu} mungu`,
    )
  }
  return munguToTugrik(mungu)
}

/** And the only place it happens on the way back in. */
export function fromQpayAmount(tugrik: number): Mungu {
  if (typeof tugrik !== 'number' || !Number.isFinite(tugrik)) {
    throw new TypeError(`QPay returned a non-numeric amount: ${String(tugrik)}`)
  }
  return tugrikToMungu(tugrik)
}

/** Sum with overflow checking. Use instead of `.reduce((a, b) => a + b, 0)`. */
export function sumMungu(amounts: readonly Mungu[]): Mungu {
  let total = 0
  for (const amount of amounts) {
    assertMungu(amount)
    total += amount
  }
  assertMungu(total)
  return total
}

/** unit price x quantity, with the same guards. */
export function lineTotal(unitPrice: Mungu, qty: number): Mungu {
  assertMungu(unitPrice)
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`Quantity must be a positive integer, got: ${qty}`)
  }
  const total = unitPrice * qty
  assertMungu(total)
  return total
}
