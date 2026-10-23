import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { atomic } from '~/db/atomic'
import { settings } from '~/db/schema'
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

  const stored = new Map(rows.map((r) => [r.key, Number(r.value)]))
  const fee = stored.get(SHIPPING_FEE)
  const freeThreshold = stored.get(FREE_THRESHOLD)

  return {
    fee: Number.isFinite(fee) ? (fee as number) : DEFAULT_RATES.fee,
    freeThreshold: Number.isFinite(freeThreshold)
      ? (freeThreshold as number)
      : DEFAULT_RATES.freeThreshold,
  }
}

export async function saveShippingRates(rates: ShippingRates): Promise<void> {
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
  await db
    .insert(settings)
    .values({ key: BOOKING_FEE, value: String(fee) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(fee) } })
}
