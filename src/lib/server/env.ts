import { z } from 'zod'
import { loadDotEnv } from '~/lib/load-dot-env'

loadDotEnv()

/**
 * Fail at boot, not at checkout. A missing QPAY_CALLBACK_SECRET should stop the
 * container from starting, not surface as an unverifiable callback at 2am.
 *
 * Server-only: importing this from a component will leak secrets into the
 * client bundle. Everything here is read through `env`, never process.env.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_URL: z.url(),
  SESSION_SECRET: z.string().min(32),

  // Optional: unset means the PGlite driver, which needs no connection string.
  DATABASE_URL: z.string().startsWith('postgres').optional(),
  DB_DRIVER: z.enum(['postgres', 'pglite']).optional(),

  /*
   * No object storage. Product images are static files in public/products/,
   * committed to the repo and served by the app — all 22 of them come to under
   * a megabyte, so a bucket, its credentials and its failure modes bought
   * nothing.
   *
   * If admin image upload lands later it needs somewhere durable, because a
   * container's filesystem does not survive a redeploy. Cloudflare R2 or a
   * Railway volume at that point; not before.
   */

  QPAY_BASE_URL: z.url(),
  QPAY_USERNAME: z.string().min(1),
  QPAY_PASSWORD: z.string().min(1),
  QPAY_INVOICE_CODE: z.string().min(1),
  QPAY_CALLBACK_SECRET: z.string().min(32),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Three 33 Barbershop <noreply@localhost>'),

  // Mungu. Configurable in admin later; env is the v1 source of truth.
  SHIPPING_FEE_UB: z.coerce.number().int().nonnegative(),
  SHIPPING_FEE_COUNTRYSIDE: z.coerce.number().int().nonnegative(),

  SENTRY_DSN: z.string().optional(),

  /**
   * TEMPORARY: shared-token admin gate, pending Phase 2 auth. Unset disables
   * the admin section entirely. See lib/server/admin/gate.ts.
   */
  ADMIN_TOKEN: z.string().min(16).optional(),
  ALLOW_TEMP_ADMIN: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}`)
}

export const env = parsed.data
export type Env = typeof env
