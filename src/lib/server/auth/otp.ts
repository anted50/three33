import { createHash, randomInt } from 'node:crypto'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { db } from '~/db'
import { otpCodes } from '~/db/schema'

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
 * A wrong guess still increments attempts before comparing — the counter has
 * to move on every try, correct or not, or it protects nothing.
 */
export async function consumeOtp(
  email: string,
  code: string,
): Promise<OtpOutcome> {
  const [row] = await db
    .select({
      id: otpCodes.id,
      codeHash: otpCodes.codeHash,
      expiresAt: otpCodes.expiresAt,
      attempts: otpCodes.attempts,
    })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)

  if (!row) return 'invalid'
  if (row.expiresAt.getTime() < Date.now()) return 'expired'
  if (row.attempts >= MAX_ATTEMPTS) return 'too_many_attempts'

  await db
    .update(otpCodes)
    .set({ attempts: row.attempts + 1 })
    .where(eq(otpCodes.id, row.id))

  if (hashCode(code) !== row.codeHash) return 'invalid'

  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(eq(otpCodes.id, row.id))

  return 'ok'
}

/** Housekeeping for the scheduled script, mirroring deleteExpiredSessions. */
export async function deleteExpiredOtpCodes(): Promise<void> {
  await db.delete(otpCodes).where(lt(otpCodes.expiresAt, new Date()))
}
