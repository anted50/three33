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
  EMAIL_FROM: z.string().default('Three33 Barbershop <noreply@localhost>'),

  /**
   * Transactional email for order receipts, via ZeptoMail's HTTP API.
   * The full `Authorization` header value ZeptoMail issues, e.g.
   * "Zoho-enczapikey <token>" — sent through as-is, not reassembled from a
   * bare token, because that is the shape ZeptoMail's dashboard hands out.
   * Unset means receipt sending is silently skipped — see
   * lib/server/email/zeptomail.ts — so an unfinished mail setup never blocks
   * checkout or settlement.
   */
  MAIL_API_TOKEN: z.string().optional(),

  /**
   * A second, VAT-enabled QPay invoice code, required for POST /ebarimt/create
   * to return a real receipt. QPAY_INVOICE_CODE above is the plain one and
   * cannot be used for this — see docs/asset-request.md #6. Unset means the
   * e-barimt step is skipped and only the plain order receipt is emailed.
   */
  QPAY_EBARIMT_INVOICE_CODE: z.string().optional(),

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
