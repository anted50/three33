import { randomInt } from 'node:crypto'
import { localDateOf } from './time'

/**
 * Booking numbers: BK-260929-7QF4. Same reasoning as orders/order-no.ts —
 * random, not a counter (no volume leak, no lock), no I/O/0/1 so it survives
 * being read over the phone, and only letters, digits and hyphens because
 * QPay's sender_invoice_no allows nothing else.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateBookingNo(now = new Date()): string {
  let suffix = ''
  for (let i = 0; i < 4; i++) suffix += ALPHABET[randomInt(ALPHABET.length)]
  return `BK-${localDateOf(now).slice(2).replaceAll('-', '')}-${suffix}`
}
