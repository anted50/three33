import { createServerFn } from '@tanstack/react-start'
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import { consumeOtp, issueOtp } from '../auth/otp'
import { sendAdminOtpEmail } from '../auth/otp-email'
import {
  createSession,
  invalidateSession,
  validateSessionToken,
} from '../auth/session'
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

    if (admin) {
      const code = await issueOtp(email)
      if (code) await sendAdminOtpEmail(email, code)
    }

    // Same response either way — whether the address belongs to an admin, a
    // customer, or nobody at all is not something this endpoint reveals.
    return { ok: true }
  })

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
      const message =
        outcome === 'too_many_attempts'
          ? 'Хэт олон удаа буруу оруулсан тул код хүчингүй боллоо'
          : outcome === 'expired'
            ? 'Кодны хугацаа дууссан байна'
            : 'Код буруу байна'
      return { ok: false, error: message }
    }

    // Re-checked rather than trusted from the request step: the code being
    // valid proves the email owner asked for it, not that the account is
    // still an admin at the moment they typed it in.
    const admin = await findAdminByEmail(email)
    if (!admin) {
      return { ok: false, error: 'Админ эрхгүй байна' }
    }

    const { token } = await createSession(admin.id, {
      userAgent: getRequestHeader('user-agent'),
      // Railway sits behind a proxy, so the socket address is useless without
      // this — same reasoning as the QPay callback's own IP handling.
      ip: getRequestIP({ xForwardedFor: true }),
    })

    setCookie(SESSION_COOKIE, token, sessionCookieOptions)

    return { ok: true }
  })

export const checkAdminSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ ok: boolean; name?: string }> => {
    const user = await validateSessionToken(getCookie(SESSION_COOKIE))
    if (!user || user.role !== 'admin') return { ok: false }
    return { ok: true, name: user.name }
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
