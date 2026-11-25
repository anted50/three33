import { createHash, randomInt } from 'node:crypto'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '~/db'
import { otpCodes } from '~/db/schema'
import { assert } from '~/lib/assert'
import { safeCompare } from './session'

/** 10 minutes: long enough to switch to a mail app, short enough that a
 * leaked code is stale. */
export const OTP_TTL_MS = 10 * 60 * 1000

/** Six digits is 10^6 guesses; capping attempts is what makes that safe. */
export const MAX_ATTEMPTS = 5

/** Refuses a second code within this window of the last one, so the request
 * form can't be used to spam an inbox. */
export const MIN_RESEND_INTERVAL_MS = 60 * 1000

function generateCode(): string {
  // randomInt, not Math.random — this is a credential, not a UI id.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * Issues a fresh code for an email, unless one was issued too recently.
 * Returns the raw code for the caller to send, or null when rate-limited —
 * callers must still report success to the browser either way, so a request
 * can't be used to probe "is there a pending code for this address".
 */
export async function issueOtp(email: string): Promise<string | null> {
  const [recent] = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)

  if (recent && Date.now() - recent.createdAt.getTime() < MIN_RESEND_INTERVAL_MS) {
    return null
  }

  const code = generateCode()

  await db.insert(otpCodes).values({
    email,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  })

  return code
}

export type OtpOutcome = 'ok' | 'invalid' | 'expired' | 'too_many_attempts'

/**
 * Verifies a code against the newest unconsumed, unexpired row for the email.
 *
 * The attempt is counted before the comparison — the counter has to move on
 * every try, correct or not, or it protects nothing — and counted by one
 * conditional UPDATE, so twenty guesses sent at once still get MAX_ATTEMPTS
 * between them, not twenty. Consuming is conditional the same way, so one
 * code signs in once.
 */
export async function consumeOtp(
  email: string,
  code: string,
): Promise<OtpOutcome> {
  const [row] = await db
    .select({ id: otpCodes.id, codeHash: otpCodes.codeHash, expiresAt: otpCodes.expiresAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)

  if (!row) return 'invalid'
  if (row.expiresAt.getTime() < Date.now()) return 'expired'

  const counted = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, row.id), lt(otpCodes.attempts, MAX_ATTEMPTS)))
    .returning({ attempts: otpCodes.attempts })
  if (counted.length === 0) return 'too_many_attempts'
  assert(counted[0]!.attempts <= MAX_ATTEMPTS, 'the attempt counter stops at MAX_ATTEMPTS')

  // Constant-time: both are fixed-length hex digests.
  if (!safeCompare(hashCode(code), row.codeHash)) return 'invalid'

  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id })
  // A concurrent request with the same code signed in first.
  if (consumed.length === 0) return 'invalid'

  return 'ok'
}

/** Housekeeping for the scheduled script, mirroring deleteExpiredSessions. */
export async function deleteExpiredOtpCodes(): Promise<void> {
  await db.delete(otpCodes).where(lt(otpCodes.expiresAt, new Date()))
}
