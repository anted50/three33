import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barbers } from '~/db/schema'
import { mungu, phone } from '../api/input'
import { getBarber } from './barbers'

/**
 * A barber's own settings. The owner-controlled parts — name, slug, active,
 * locations, terms — are not editable here.
 *
 * bookingFee: 0 turns online booking off (customers see "call to book").
 * Changing the fee or buffer never touches existing appointments; each one
 * froze its own values when it was booked.
 */
export const profilePatch = z
  .object({
    phone,
    bioMn: z.string().trim().max(2000).nullable(),
    bioEn: z.string().trim().max(2000).nullable(),
    photoUrl: z.url().max(1000).nullable(),
    bookingFee: mungu,
    bufferMinutes: z.number().int().min(0).max(120),
  })
  .partial()

export async function getProfile(barberId: string) {
  return getBarber(barberId)
}

export async function updateProfile(barberId: string, patch: z.infer<typeof profilePatch>) {
  if (Object.keys(patch).length > 0) {
    await db.update(barbers).set(patch).where(eq(barbers.id, barberId))
  }
  return getBarber(barberId)
}
