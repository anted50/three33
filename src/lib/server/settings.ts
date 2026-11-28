import { eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { atomic } from '~/db/atomic'
import { settings } from '~/db/schema'
import { assert } from '~/lib/assert'
import type { ShippingRates } from './cart/pricing'

/**
 * Server-only. The delivery fee used to come from env, which meant a redeploy
 * to change a number the shop changes with the seasons — it lives in the
 * settings table now and is edited from /admin/settings.
 */

const SHIPPING_FEE = 'shipping_fee'
const FREE_THRESHOLD = 'shipping_free_threshold'
const BOOKING_FEE = 'booking_fee'

/** Mungu. Used until the shop saves its own numbers. */
const DEFAULT_RATES: ShippingRates = {
  fee: 500_000,
  freeThreshold: 5_000_000,
}

export async function loadShippingRates(): Promise<ShippingRates> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [SHIPPING_FEE, FREE_THRESHOLD]))
    .limit(2)

  const stored = new Map(rows.map((row) => [row.key, row.value]))
  return {
    fee: storedAmount(stored.get(SHIPPING_FEE), DEFAULT_RATES.fee),
    freeThreshold: storedAmount(stored.get(FREE_THRESHOLD), DEFAULT_RATES.freeThreshold),
  }
}

/**
 * A stored amount in mungu, or `fallback` when it is missing or is not what
 * saveShippingRates would have written (a whole, non-negative number), so a
 * hand-edited row can never put fractional money into a cart total.
 */
function storedAmount(value: string | undefined, fallback: number): number {
  assert(Number.isSafeInteger(fallback), 'the default is whole mungu')
  if (value === undefined) return fallback
  const amount = Number(value)
  if (Number.isSafeInteger(amount) && amount >= 0) return amount
  return fallback
}

export async function saveShippingRates(rates: ShippingRates): Promise<void> {
  // The route validates these; checked again because a bad value here is
  // charged to every customer until someone notices.
  assert(Number.isInteger(rates.fee), 'shipping fee is whole mungu')
  assert(rates.fee >= 0, 'shipping fee is not negative')
  assert(Number.isInteger(rates.freeThreshold), 'free-shipping threshold is whole mungu')
  assert(rates.freeThreshold >= 0, 'free-shipping threshold is not negative')
  await atomic(
    (
      [
        [SHIPPING_FEE, rates.fee],
        [FREE_THRESHOLD, rates.freeThreshold],
      ] as const
    ).map(([key, value]) =>
      db
        .insert(settings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: String(value) },
        }),
    ),
  )
}

/**
 * The online booking fee, in mungu — what a customer pays through QPay to
 * confirm a booking. Null until an admin sets it, and online booking is
 * refused until then: a made-up default would quietly start charging
 * customers a price nobody chose.
 */
export async function loadBookingFee(): Promise<number | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, BOOKING_FEE)).limit(1)
  const fee = row ? Number(row.value) : Number.NaN
  return Number.isInteger(fee) && fee > 0 ? fee : null
}

export async function saveBookingFee(fee: number): Promise<void> {
  // Paired with loadBookingFee, which treats anything else as "not set".
  assert(Number.isInteger(fee), 'booking fee is whole mungu')
  assert(fee > 0, 'booking fee is positive')
  await db
    .insert(settings)
    .values({ key: BOOKING_FEE, value: String(fee) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(fee) } })
}
