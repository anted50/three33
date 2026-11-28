import { getCookie } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { users } from '~/db/schema'
import { assert } from '~/lib/assert'
import { validateSessionToken } from '../auth/session'
import { SESSION_COOKIE } from '../cookies'

/**
 * Server-only admin auth internals. Never imported from a route — see
 * lib/server/cart/internal.ts for why that boundary matters: a route file
 * pulls in everything a module touches, `db` included, and this one touches
 * it at module scope.
 */

/**
 * Callers normalise first: emails are stored lower-cased (scripts/add-admin.ts)
 * and compared exactly, so a mixed-case lookup would quietly find nobody.
 */
export async function findAdminByEmail(email: string) {
  assert(email.length > 0, 'an admin lookup needs an email')
  assert(email === email.trim().toLowerCase(), 'the email is normalised before lookup')

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

  if (user && user.role === 'admin') return user
  return null
}

/**
 * Every admin server function's first line — see admin/internal.ts. A server
 * function is a public HTTP endpoint regardless of which layout rendered the
 * page that called it, so this re-checks independently rather than trusting
 * that the /admin route guard already ran.
 */
export async function assertAdminSession(): Promise<{ id: string }> {
  const user = await validateSessionToken(getCookie(SESSION_COOKIE))
  if (!user || user.role !== 'admin') throw new Error('UNAUTHORISED')
  return { id: user.id }
}
