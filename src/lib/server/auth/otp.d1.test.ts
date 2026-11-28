import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '~/db'
import { otpCodes } from '~/db/schema'
import { consumeOtp, issueOtp, MAX_ATTEMPTS, OTP_CODES_PER_DAY_MAX } from './otp'

/**
 * One-time sign-in codes on a real local D1. What is under test is the
 * attempt limit and single use under concurrency — the properties that make
 * a six-digit code safe to send.
 */

let seq = 0
const freshEmail = () => `otp-${++seq}@example.com`
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('consumeOtp', () => {
  it('signs in once with the right code', async () => {
    // Goal: the happy path, and that a used code is spent.
    const email = freshEmail()
    const code = await issueOtp(email)
    expect(code).not.toBeNull()

    expect(await consumeOtp(email, code!)).toBe('ok')
    expect(await consumeOtp(email, code!)).toBe('invalid')
  })

  it('counts concurrent guesses: twenty at once still get MAX_ATTEMPTS between them', async () => {
    // Goal: the attempt counter cannot be raced. Twenty wrong guesses fired
    // together must leave the counter at the limit, and the right code must
    // then be refused.
    const email = freshEmail()
    const code = (await issueOtp(email))!

    const outcomes = await Promise.all(Array.from({ length: 20 }, () => consumeOtp(email, wrongCode(code))))

    expect(outcomes.filter((outcome) => outcome === 'invalid')).toHaveLength(MAX_ATTEMPTS)
    expect(outcomes.filter((outcome) => outcome === 'too_many_attempts')).toHaveLength(20 - MAX_ATTEMPTS)
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.email, email))
    expect(row!.attempts).toBe(MAX_ATTEMPTS)
    expect(await consumeOtp(email, code)).toBe('too_many_attempts')
  })

  it('the same right code sent twice at once signs in once', async () => {
    // Goal: single use holds under a race (double-submitted form).
    const email = freshEmail()
    const code = (await issueOtp(email))!

    const outcomes = await Promise.all([consumeOtp(email, code), consumeOtp(email, code)])

    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1)
  })
})

describe('issueOtp', () => {
  /** Puts `n` codes on record for `email`, issued `ageMs` ago. */
  async function codesIssuedAgo(email: string, n: number, ageMs: number) {
    const createdAt = new Date(Date.now() - ageMs)
    for (let index = 0; index < n; index++) {
      await db.insert(otpCodes).values({ email, codeHash: `h-${index}`, expiresAt: createdAt, createdAt })
    }
  }

  it('refuses a second code within a minute of the first', async () => {
    const email = freshEmail()
    expect(await issueOtp(email)).not.toBeNull()
    expect(await issueOtp(email)).toBeNull()
  })

  it('issues one code when two requests arrive at once', async () => {
    // Goal: the resend limit cannot be raced. Method: two requests together;
    // exactly one may insert.
    const email = freshEmail()
    const codes = await Promise.all([issueOtp(email), issueOtp(email)])

    expect(codes.filter((code) => code !== null)).toHaveLength(1)
    const rows = await db.select().from(otpCodes).where(eq(otpCodes.email, email))
    expect(rows).toHaveLength(1)
  })

  it('stops at OTP_CODES_PER_DAY_MAX codes a day', async () => {
    // Goal: new codes cannot buy unlimited guesses. Method: a day's worth of
    // codes, all older than the resend window, then one more request.
    const email = freshEmail()
    await codesIssuedAgo(email, OTP_CODES_PER_DAY_MAX, 5 * 60 * 1000)

    expect(await issueOtp(email)).toBeNull()
  })

  it('counts only the last day toward the daily limit', async () => {
    const email = freshEmail()
    await codesIssuedAgo(email, OTP_CODES_PER_DAY_MAX, 25 * 60 * 60 * 1000)

    expect(await issueOtp(email)).not.toBeNull()
  })
})
