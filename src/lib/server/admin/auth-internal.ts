import { getCookie } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { users } from '~/db/schema'
import { validateSessionToken } from '../auth/session'
import { SESSION_COOKIE } from '../cookies'

/**
 * Server-only admin auth internals. Never imported from a route — see
 * lib/server/cart/internal.ts for why that boundary matters: a route file
 * pulls in everything a module touches, `db` included, and this one touches
 * it at module scope.
 */

export async function findAdminByEmail(email: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  return user && user.role === 'admin' ? user : null
}

/**
 * Every admin server function's first line — see admin/internal.ts. A server
 * function is a public HTTP endpoint regardless of which layout rendered the
 * page that called it, so this re-checks independently rather than trusting
 * that the /admin route guard already ran.
 */
export async function assertAdminSession(): Promise<void> {
  const user = await validateSessionToken(getCookie(SESSION_COOKIE))
  if (!user || user.role !== 'admin') throw new Error('UNAUTHORISED')
}
