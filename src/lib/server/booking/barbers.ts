import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barbers, users } from '~/db/schema'
import { SLUG_RE, slugify } from '~/lib/slugify'
import { conflict, notFound } from '../api/errors'
import { email, mungu, phone } from '../api/input'
import { locationIdsOf, setLocations } from './barber-locations'
import { addTerms, currentTerms, termsInput } from './terms'

/**
 * Owner-side barber management. Creating a barber creates their login too:
 * there is no signup, and the barber signs in with an emailed code.
 */

const profileFields = {
  name: z.string().trim().min(1).max(120),
  phone,
  bioMn: z.string().trim().max(2000).nullish(),
  bioEn: z.string().trim().max(2000).nullish(),
  photoUrl: z.url().max(1000).nullish(),
  bookingFee: mungu.optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}

export const createBarberInput = z.object({
  /** The login. An existing user with this email (e.g. the owner) is reused. */
  email,
  slug: z.string().regex(SLUG_RE).max(60).optional(),
  ...profileFields,
  locationIds: z.array(z.uuid()).min(1).max(20),
  /** On hold while the owner is the only barber: none = keeps everything. */
  terms: termsInput.optional(),
})

export const updateBarberInput = z
  .object({ email, slug: z.string().regex(SLUG_RE).max(60), isActive: z.boolean(), ...profileFields })
  .partial()

export async function listBarbers() {
  const rows = await db.select({ id: barbers.id }).from(barbers).orderBy(asc(barbers.sortOrder), asc(barbers.name))
  return Promise.all(rows.map((r) => getBarber(r.id)))
}

export async function getBarber(id: string) {
  const [row] = await db
    .select({ barber: barbers, email: users.email })
    .from(barbers)
    .leftJoin(users, eq(users.id, barbers.userId))
    .where(eq(barbers.id, id))
    .limit(1)
  if (!row) throw notFound('Barber')
  return {
    ...row.barber,
    email: row.email,
    locationIds: await locationIdsOf(id),
    terms: await currentTerms(id),
  }
}

export async function createBarber(input: z.infer<typeof createBarberInput>, ownerId: string) {
  const id = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1)
    const userId =
      existing?.id ??
      (await tx.insert(users).values({ email: input.email, name: input.name }).returning({ id: users.id }))[0]!.id

    const { email: _email, locationIds, terms, slug, ...profile } = input
    const [barber] = await tx
      .insert(barbers)
      .values({ ...profile, slug: slug ?? slugify(input.name), userId })
      .returning({ id: barbers.id })

    await setLocations(barber!.id, locationIds, tx)
    if (terms) await addTerms(barber!.id, terms, ownerId, tx)
    return barber!.id
  })
  return getBarber(id)
}

export async function updateBarber(id: string, patch: z.infer<typeof updateBarberInput>) {
  const { email: newEmail, ...fields } = patch
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ userId: barbers.userId }).from(barbers).where(eq(barbers.id, id)).limit(1)
    if (!row) throw notFound('Barber')
    if (Object.keys(fields).length > 0) await tx.update(barbers).set(fields).where(eq(barbers.id, id))
    if (newEmail) {
      if (!row.userId) throw conflict('NO_LOGIN', 'This barber has no login to change')
      await tx.update(users).set({ email: newEmail }).where(eq(users.id, row.userId))
    }
  })
  return getBarber(id)
}
