import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '~/db'
import { otpCodes } from '~/db/schema'
import { consumeOtp, issueOtp, MAX_ATTEMPTS } from './otp'

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
