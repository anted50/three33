import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { services } from '~/db/schema'
import { notFound } from '../api/errors'
import { mungu } from '../api/input'

/**
 * What can be booked: a name and a length ("Haircut", 45 minutes), managed
 * by the barber from admin. Editing a service never changes a booking — each
 * one copied the name and length when it was made. There is no delete:
 * deactivate instead, so past bookings keep pointing at a real row.
 */

export const serviceInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullish(),
  durationMinutes: z.number().int().min(5).max(600),
  /** Shown on the site; paid at the shop. Null = not shown. */
  price: mungu.nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export const servicePatch = serviceInput.partial()

export async function listServices({ activeOnly }: { activeOnly: boolean }) {
  return db
    .select()
    .from(services)
    .where(activeOnly ? eq(services.isActive, true) : undefined)
    .orderBy(asc(services.sortOrder), asc(services.name))
}

export async function createService(input: z.infer<typeof serviceInput>) {
  const [row] = await db.insert(services).values(input).returning()
  return row!
}

export async function updateService(serviceId: string, patch: z.infer<typeof servicePatch>) {
  const [row] = await db.update(services).set(patch).where(eq(services.id, serviceId)).returning()
  if (!row) throw notFound('Service')
  return row
}

/** An active service, or a 404 — what a booking must be for. */
export async function bookableService(serviceId: string) {
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.isActive, true)))
    .limit(1)
  if (!row) throw notFound('Service')
  return row
}
