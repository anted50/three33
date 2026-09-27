import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { codeRequestInput, requestCode } from '~/lib/server/api/staff-login'

/**
 * POST /api/v1/auth/code — step 1 of staff sign-in
 *
 * Emails a 6-digit code if the address belongs to an owner or an active
 * barber. Answers 202 either way, so it can't reveal who works here. One
 * code per address per minute.
 *
 * Auth   none
 * Body   { "email": "bat@three33.mn" }
 * 202    { "ok": true }
 * 400    VALIDATION
 *
 * Next: POST /api/v1/auth/session with the code.
 */
export const Route = createFileRoute('/api/v1/auth/code')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          const { email } = await readBody(request, codeRequestInput)
          await requestCode(email)
          return { ok: true }
        }, 202),
    },
  },
})
