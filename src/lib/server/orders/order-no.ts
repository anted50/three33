import { randomInt } from 'node:crypto'

/**
 * Human-facing order number, also sent to QPay as sender_invoice_no.
 *
 * Constraints that shape the format:
 *  - QPay rejects special characters, so letters, digits and hyphens only.
 *  - sender_invoice_no must be unique *forever* — QPay refuses a repeat, and a
 *    collision at checkout would look like a payment failure to the customer.
 *  - Customers read it aloud to a barber over the phone, so it stays short.
 *
 * Format: UD-YYMMDD-XXXX, e.g. UD-260803-7QF4.
 *
 * The suffix is random rather than a counter: a sequence would leak daily order
 * volume to anyone who placed two orders, and a counter needs a lock the rest
 * of checkout does not.
 */

/** No I, O, 0 or 1 — they are misread when a number is dictated by phone. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateOrderNo(now = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(2)
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')

  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)]
  }

  return `UD-${yy}${mm}${dd}-${suffix}`
}

/** QPay's constraint, asserted rather than assumed. */
export function isValidOrderNo(orderNo: string): boolean {
  return /^[A-Za-z0-9-]{1,45}$/.test(orderNo)
}
