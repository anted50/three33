import { randomInt } from 'node:crypto'
import { localDateOf } from './time'

/**
 * Short, human-readable references: BK-260929-7QF4 for bookings, SL-… for POS
 * sales. Same reasoning as orders/order-no.ts — random, not a counter (no
 * volume leak, no lock), no I/O/0/1 so it survives being read over the
 * phone, and only letters, digits and hyphens because QPay's
 * sender_invoice_no allows nothing else.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function suffix(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export function generateRef(prefix: 'BK' | 'SL', now = new Date()): string {
  return `${prefix}-${localDateOf(now).slice(2).replaceAll('-', '')}-${suffix(4)}`
}

/** QPay needs a sender_invoice_no that is unique forever, and one sale can
 * take several QPay payments — so each invoice gets its own suffix. */
export function invoiceRef(saleNo: string): string {
  return `${saleNo}-${suffix(3)}`
}
