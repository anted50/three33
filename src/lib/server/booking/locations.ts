import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { locations } from '~/db/schema'
import { SLUG_RE } from '~/lib/slugify'
import { notFound } from '../api/errors'

/** Locations: created and edited by the owner, read by everyone. */

export const locationInput = z.object({
  slug: z.string().regex(SLUG_RE, 'lowercase-words-with-hyphens').max(60),
  nameMn: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  phone: z.string().trim().max(40).nullish(),
  mapLink: z.url().max(1000).nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
})

export const locationPatch = locationInput.partial()

export async function listLocations(opts: { activeOnly: boolean }) {
  const rows = await db.select().from(locations).orderBy(asc(locations.sortOrder), asc(locations.nameEn))
  return opts.activeOnly ? rows.filter((l) => l.isActive) : rows
}

export async function getLocation(id: string) {
  const [row] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  if (!row) throw notFound('Location')
  return row
}

export async function createLocation(input: z.infer<typeof locationInput>) {
  const [row] = await db.insert(locations).values(input).returning()
  return row!
}

export async function updateLocation(id: string, patch: z.infer<typeof locationPatch>) {
  const [row] = await db.update(locations).set(patch).where(eq(locations.id, id)).returning()
  if (!row) throw notFound('Location')
  return row
}
