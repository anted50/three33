import { createHash, randomInt } from 'node:crypto'
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { db } from '~/db'
import { atomic, exists, guard } from '~/db/atomic'
import { otpCodes } from '~/db/schema'
import { assert } from '~/lib/assert'
import { isGuardFailure } from '../api/db-errors'
import { safeCompare } from './session'

/** 10 minutes: long enough to switch to a mail app, short enough that a
 * leaked code is stale. */
export const OTP_TTL_MS = 10 * 60 * 1000

/** Six digits is 10^6 guesses; capping attempts is what makes that safe. */
export const MAX_ATTEMPTS = 5

/** Refuses a second code within this window of the last one, so the request
 * form can't be used to spam an inbox. */
export const MIN_RESEND_INTERVAL_MS = 60 * 1000

/**
 * Codes one email can be sent per day. Each code allows MAX_ATTEMPTS
 * guesses, so this caps guessing at 50 a day against a million codes: a
 * one-in-20,000 chance per day. Without it, asking for a new code every
 * minute bought five fresh guesses each time.
 */
export const OTP_CODES_PER_DAY_MAX = 10
const DAY_MS = 24 * 60 * 60 * 1000

function generateCode(): string {
  // randomInt, not Math.random — this is a credential, not a UI id.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  assert(/^[0-9]{6}$/.test(code), 'a code is exactly six digits')
  return code
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * Issues a fresh code for an email, unless one was issued in the last minute
 * or the email has had OTP_CODES_PER_DAY_MAX codes today. Returns the raw
 * code for the caller to send, or null when refused — callers must still
 * report success to the browser either way, so a request can't be used to
 * probe "is there a pending code for this address".
 *
 * Both limits are guards in the same batch as the insert, so two requests
 * at the same moment cannot both pass a check and both insert.
 */
export async function issueOtp(email: string): Promise<string | null> {
  assert(email.length > 0, 'a code is issued for an email')
  const now = Date.now()
  const code = generateCode()

  try {
    await atomic([
      guard(sql`not ${exists(unconsumedCodeSince(email, now - MIN_RESEND_INTERVAL_MS))}`, 'OTP_RESEND_TOO_SOON'),
      guard(sql`${codesIssuedSince(email, now - DAY_MS)} < ${OTP_CODES_PER_DAY_MAX}`, 'OTP_DAILY_LIMIT'),
      db.insert(otpCodes).values({
        email,
        codeHash: hashCode(code),
        expiresAt: new Date(now + OTP_TTL_MS),
      }),
    ])
  } catch (error) {
    if (isGuardFailure(error, 'OTP_RESEND_TOO_SOON')) return null
    if (isGuardFailure(error, 'OTP_DAILY_LIMIT')) return null
    throw error
  }

  return code
}

/** An unconsumed code for `email` created after `sinceMs`. */
function unconsumedCodeSince(email: string, sinceMs: number) {
  return db
    .select({ id: otpCodes.id })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt), gt(otpCodes.createdAt, new Date(sinceMs))))
}

/** How many codes `email` has been issued since `sinceMs`, used or not. */
function codesIssuedSince(email: string, sinceMs: number) {
  return db
    .select({ count: count() })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), gt(otpCodes.createdAt, new Date(sinceMs))))
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
