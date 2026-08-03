import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { grantAdmin, isAdmin, revokeAdmin } from './gate-internal'

/**
 * The admin gate's public surface. Routes import from HERE only.
 *
 * Server functions and schemas, nothing else. Exporting a plain helper here
 * would keep this module — and `env`, holding both the QPay password and the
 * admin token — in the client graph. The build caught exactly that when these
 * lived in one file: `node:path` is not available in the browser, so it failed
 * loudly. It would not always fail loudly.
 */

export const unlockAdminInput = z.object({
  token: z.string().min(1).max(200),
})

export const unlockAdmin = createServerFn({ method: 'POST' })
  .validator(unlockAdminInput)
  .handler(
    async ({ data }): Promise<{ ok: boolean; error?: string }> =>
      grantAdmin(data.token),
  )

export const checkAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ ok: boolean }> => ({ ok: isAdmin() }),
)

export const lockAdmin = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: true }> => {
    revokeAdmin()
    return { ok: true }
  },
)
