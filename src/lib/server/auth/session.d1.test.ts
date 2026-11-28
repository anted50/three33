import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '~/db'
import { sessions, users } from '~/db/schema'
import { createSession, hashSessionToken, SESSION_TTL_SECONDS, validateSessionToken } from './session'

/**
 * Sliding session expiry on a real local D1. What is under test is the
 * `renewed` flag: the caller re-sends the cookie only when it is true, so it
 * must be true exactly when the row's expiry moved.
 */

let seq = 0

async function signedInUser() {
  const userId = crypto.randomUUID()
  await db.insert(users).values({ id: userId, email: `session-${++seq}@example.com`, name: 'Admin', role: 'admin' })
  return createSession(userId)
}

describe('validateSessionToken', () => {
  it('does not renew a session in the first half of its life', async () => {
    const { token } = await signedInUser()

    const user = await validateSessionToken(token)

    expect(user).not.toBeNull()
    expect(user!.renewed).toBe(false)
  })

  it('renews a session past the halfway mark and says so', async () => {
    // Goal: an active admin is not logged out at day 30. Method: move the
    // row's expiry to 10 days out, then check it was pushed back to 30.
    const { token } = await signedInUser()
    const sessionId = hashSessionToken(token)
    const tenDaysMs = 10 * 24 * 60 * 60 * 1000
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + tenDaysMs) }).where(eq(sessions.id, sessionId))

    const user = await validateSessionToken(token)

    expect(user!.renewed).toBe(true)
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_TTL_SECONDS * 1000 - 60_000)
  })

  it('refuses an expired session', async () => {
    const { token } = await signedInUser()
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashSessionToken(token)))

    expect(await validateSessionToken(token)).toBeNull()
  })
})
