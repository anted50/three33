import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { users } from '~/db/schema'
import { sendAdminOtpEmail } from '../auth/otp-email'
import { consumeOtp, issueOtp } from '../auth/otp'
import { createSession } from '../auth/session'
import { email } from './input'
import { ApiError } from './errors'
import { findStaffUserByEmail } from './staff'

/**
 * Staff sign-in: an emailed 6-digit code, nothing else — no passwords exist.
 * The same otp_codes and sessions as the /admin login, so one sign-in covers
 * /admin and /barber.
 *
 * Who can sign in: owners, and users linked to an ACTIVE barber row. Nobody
 * signs up; the owner creates barbers (and with them, their login).
 */

export const codeRequestInput = z.object({ email })
export const codeVerifyInput = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits'),
})

/**
 * Sends a code if the email belongs to staff. The caller always answers the
 * same way, so this can't be used to find out who works here.
 */
export async function requestCode(address: string): Promise<void> {
  const user = await findStaffUserByEmail(address)
  if (!user) return
  const code = await issueOtp(address)
  if (!code) return // one code a minute per address
  try {
    await sendAdminOtpEmail(address, code, 'Нэвтрэх код')
  } catch (error) {
    // Logged, not surfaced: surfacing it would reveal the address is staff.
    console.error(`staff login: code email failed for ${address}`, error)
  }
}

const REJECTED: Record<string, string> = {
  invalid: 'The code is wrong',
  expired: 'The code has expired; ask for a new one',
  too_many_attempts: 'Too many wrong tries; ask for a new code',
}

/** Checks the code and opens a session. Returns the cookie token. */
export async function verifyCode(
  input: z.infer<typeof codeVerifyInput>,
  meta: { userAgent: string | null; ip: string | null },
): Promise<string> {
  const outcome = await consumeOtp(input.email, input.code)
  if (outcome !== 'ok') throw new ApiError(401, 'CODE_REJECTED', REJECTED[outcome] ?? 'The code is wrong')

  // Re-checked now: a valid code proves the inbox, not that the person is
  // still staff at the moment they typed it.
  const user = await findStaffUserByEmail(input.email)
  if (!user) throw new ApiError(403, 'NOT_STAFF', 'This account has no access')

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)))

  const { token } = await createSession(user.id, meta)
  return token
}
