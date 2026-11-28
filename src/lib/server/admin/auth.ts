import { createServerFn } from '@tanstack/react-start'
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  setCookie,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import { assert, assertNever } from '~/lib/assert'
import { consumeOtp, issueOtp, type OtpOutcome } from '../auth/otp'
import { sendAdminOtpEmail } from '../auth/otp-email'
import {
  createSession,
  invalidateSession,
  validateSessionToken,
} from '../auth/session'
import { inBackground } from '../background'
import { clientIp } from '../client-ip'
import { SESSION_COOKIE, sessionCookieOptions } from '../cookies'
import { findAdminByEmail } from './auth-internal'

/**
 * Admin auth's public surface. Routes import from HERE only — see
 * admin/admin.ts for why that boundary matters.
 *
 * Real per-user auth: email OTP against users.role === 'admin', backed by the
 * same DB-sessions used everywhere else — see lib/server/auth/session.ts.
 * Replaces the old shared-token gate (gate.ts / gate-internal.ts, now
 * deleted). New admins are granted with `npm run admin:add <email>` — see
 * scripts/add-admin.ts. There is no self-service signup, deliberately: an
 * OTP only ever logs someone into an account that already exists.
 */

export const requestAdminLoginInput = z.object({
  email: z.email().max(255),
})

export const requestAdminLogin = createServerFn({ method: 'POST' })
  .validator(requestAdminLoginInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const email = data.email.trim().toLowerCase()
    const admin = await findAdminByEmail(email)

    // In the background, after the response: issuing and emailing a code
    // takes time, and can fail, only for an admin's address. Awaiting it here
    // would let the response time, or an error, say which addresses are
    // admins. Failures are logged by inBackground.
    if (admin) {
      inBackground('admin login code', issueAndSendCode(email))
    }

    // Same response either way — whether the address belongs to an admin, a
    // customer, or nobody at all is not something this endpoint reveals.
    return { ok: true }
  })

/** Issues a login code and emails it, unless issueOtp refuses a new one. */
async function issueAndSendCode(email: string): Promise<void> {
  const code = await issueOtp(email)
  if (code === null) return
  await sendAdminOtpEmail(email, code)
}

export const verifyAdminLoginInput = z.object({
  email: z.email().max(255),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Код 6 оронтой байх ёстой'),
})

export const verifyAdminLogin = createServerFn({ method: 'POST' })
  .validator(verifyAdminLoginInput)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const email = data.email.trim().toLowerCase()
    const outcome = await consumeOtp(email, data.code)
    if (outcome !== 'ok') {
      return { ok: false, error: otpRefusalMessage(outcome) }
    }

    // Re-checked rather than trusted from the request step: the code being
    // valid proves the email owner asked for it, not that the account is
    // still an admin at the moment they typed it in.
    const admin = await findAdminByEmail(email)
    if (!admin) {
      return { ok: false, error: 'Админ эрхгүй байна' }
    }
    assert(admin.email === email, 'the admin found is the one whose code was consumed')

    const { token } = await createSession(admin.id, {
      userAgent: getRequestHeader('user-agent'),
      ip: clientIp(getRequestHeader),
    })

    setCookie(SESSION_COOKIE, token, sessionCookieOptions)

    return { ok: true }
  })

/** What the login form shows for each way a code can be refused. */
function otpRefusalMessage(outcome: Exclude<OtpOutcome, 'ok'>): string {
  switch (outcome) {
    case 'too_many_attempts':
      return 'Хэт олон удаа буруу оруулсан тул код хүчингүй боллоо'
    case 'expired':
      return 'Кодны хугацаа дууссан байна'
    case 'invalid':
      return 'Код буруу байна'
    default:
      return assertNever(outcome, 'unhandled OTP outcome')
  }
}

export const checkAdminSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{
    ok: boolean
    userId?: string
    email?: string
    name?: string
  }> => {
    const token = getCookie(SESSION_COOKIE)
    const user = await validateSessionToken(token)
    if (!user || user.role !== 'admin') return { ok: false }

    // Every admin page load passes through here, so this is where a renewed
    // session gets a cookie that lives as long as its row does.
    if (user.renewed) {
      assert(token, 'a renewed session came from a cookie')
      setCookie(SESSION_COOKIE, token, sessionCookieOptions)
    }
    return { ok: true, userId: user.id, email: user.email, name: user.name }
  },
)

export const adminLogout = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: true }> => {
    const token = getCookie(SESSION_COOKIE)
    if (token) await invalidateSession(token)
    deleteCookie(SESSION_COOKIE, sessionCookieOptions)
    return { ok: true }
  },
)
