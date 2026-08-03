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

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  S3_PUBLIC_URL: z.url(),

  QPAY_BASE_URL: z.url(),
  QPAY_USERNAME: z.string().min(1),
  QPAY_PASSWORD: z.string().min(1),
  QPAY_INVOICE_CODE: z.string().min(1),
  QPAY_CALLBACK_SECRET: z.string().min(32),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Uppercut Deluxe Mongolia <noreply@localhost>'),

  // Mungu. Configurable in admin later; env is the v1 source of truth.
  SHIPPING_FEE_UB: z.coerce.number().int().nonnegative(),
  SHIPPING_FEE_COUNTRYSIDE: z.coerce.number().int().nonnegative(),

  SENTRY_DSN: z.string().optional(),
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
