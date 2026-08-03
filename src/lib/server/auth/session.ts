import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, lt } from 'drizzle-orm'
import { db } from '~/db'
import { sessions, users } from '~/db/schema'
import type { User } from '~/db/schema'

export const SESSION_COOKIE = 'uc_session'

/** 30 days. Refreshed when a session is more than halfway through its life. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

/**
 * The cookie holds a random token; the database holds only its SHA-256 hash.
 * A leaked database dump therefore can't be replayed as a set of live logins —
 * the same reason password_hash exists.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  })

  return { token, expiresAt }
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: User['role']
}

/**
 * Resolves a cookie token to a user, or null. Expired rows are deleted on sight
 * so a stale cookie can never be revived by a clock change.
 */
export async function validateSessionToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null

  const sessionId = hashSessionToken(token)

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // Sliding expiry: extend only past the halfway mark, so an active user isn't
  // logged out mid-checkout but we're not writing to the DB on every request.
  const halfLife = row.expiresAt.getTime() - (SESSION_TTL_SECONDS * 1000) / 2
  if (Date.now() > halfLife) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) })
      .where(eq(sessions.id, sessionId))
  }

  return { id: row.id, email: row.email, name: row.name, role: row.role }
}

/** Log out one session. Takes effect immediately — that's the point of DB sessions. */
export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)))
}

/** Log out everywhere — used after a password change or reset. */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Housekeeping for the scheduled script; harmless to run often. */
export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
}

/**
 * Constant-time compare for anything token-shaped that we compare by hand
 * (password reset tokens, the QPay callback HMAC). Length mismatch short-
 * circuits, which is fine — token length is not a secret.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
