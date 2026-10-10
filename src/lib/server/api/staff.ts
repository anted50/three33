import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { barbers, users } from '~/db/schema'
import { validateSessionToken } from '../auth/session'

/**
 * Who is calling. Resolved from the session cookie on every authenticated
 * request — never cached — so deactivating a barber or demoting an owner takes
 * effect on their very next request.
 *
 *   isOwner   users.role = 'admin'
 *   barberId  the ACTIVE barbers row linked to this user, if any
 *
 * An owner who also cuts hair has both. Anyone with neither is not staff.
 */
export interface Staff {
  userId: string
  email: string
  name: string
  isOwner: boolean
  barberId: string | null
}

export async function resolveStaff(token: string | null): Promise<Staff | null> {
  const user = await validateSessionToken(token)
  if (!user) return null

  const barberId = await activeBarberIdFor(user.id)
  const isOwner = user.role === 'admin'
  if (!isOwner && !barberId) return null

  return { userId: user.id, email: user.email, name: user.name, isOwner, barberId }
}

/** Who may receive a sign-in code: owners, and users linked to an active
 * barber. Looked up by email because the code is requested before sign-in. */
export async function findStaffUserByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (!user) return null
  if (user.role === 'admin') return user
  return (await activeBarberIdFor(user.id)) ? user : null
}

async function activeBarberIdFor(userId: string): Promise<string | null> {
  const [barber] = await db
    .select({ id: barbers.id, isActive: barbers.isActive })
    .from(barbers)
    .where(eq(barbers.userId, userId))
    .limit(1)
  return barber?.isActive ? barber.id : null
}
