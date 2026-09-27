import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { services } from '~/db/schema'
import { notFound } from '../api/errors'
import { mungu } from '../api/input'
import { assertWorksAt } from './barber-locations'

/**
 * A barber's own services. Each row is one service at one location with its
 * own price and duration; the same haircut elsewhere is another row.
 * Editing never changes past or upcoming appointments — they froze the name,
 * price and duration when booked. There is no delete: deactivate instead.
 */

export const serviceInput = z.object({
  locationId: z.uuid(),
  nameEn: z.string().trim().min(1).max(120),
  nameMn: z.string().trim().max(120).nullish(),
  descriptionEn: z.string().trim().max(2000).nullish(),
  descriptionMn: z.string().trim().max(2000).nullish(),
  price: mungu,
  durationMinutes: z.number().int().min(5).max(600),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

/** The location is fixed once created — a different branch is a new row. */
export const servicePatch = serviceInput.omit({ locationId: true }).partial()

export async function listServices(barberId: string) {
  return db
    .select()
    .from(services)
    .where(eq(services.barberId, barberId))
    .orderBy(asc(services.locationId), asc(services.sortOrder), asc(services.nameEn))
}

export async function createService(barberId: string, input: z.infer<typeof serviceInput>) {
  await assertWorksAt(barberId, [input.locationId])
  const [row] = await db.insert(services).values({ ...input, barberId }).returning()
  return row!
}

export async function updateService(
  barberId: string,
  serviceId: string,
  patch: z.infer<typeof servicePatch>,
) {
  const [row] = await db
    .update(services)
    .set(patch)
    .where(and(eq(services.id, serviceId), eq(services.barberId, barberId)))
    .returning()
  if (!row) throw notFound('Service')
  return row
}
