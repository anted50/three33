import { z } from 'zod'
import { loadDotEnv } from '~/lib/load-dot-env'

loadDotEnv()

/**
 * An unset .env value is read back as `""`, not `undefined` — process.env
 * only ever holds strings. `.optional()` alone lets an unset var through
 * (undefined skips validation) but does nothing for one written as an empty
 * line in .env, which still has to clear whatever the inner schema requires
 * (`.min(1)`, `.url()`...) and fails boot on a block nobody has filled in
 * yet. This treats blank the same as absent for a genuinely optional group.
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

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

  /**
   * StorePay — a merchant installment ("хойшлуулсан төлбөр") loan, offered as
   * a second checkout option alongside the QPay QR transfer above. Optional as
   * a group: unset means the option is hidden from checkout rather than
   * failing the build, since onboarding with StorePay lands independently of
   * a deploy. getStorepayProvider() throws a clear error if it is ever called
   * without every one of these set — see storepay/index.ts.
   */
  STOREPAY_BASE_URL: optional(z.url()),
  /** Client credentials, sent as HTTP Basic on /oauth/token. */
  STOREPAY_APP_USERNAME: optional(z.string().min(1)),
  STOREPAY_APP_PASSWORD: optional(z.string().min(1)),
  /** Resource-owner credentials StorePay issued this merchant, sent as the
   * password-grant username/password. Distinct from the app credentials above. */
  STOREPAY_USERNAME: optional(z.string().min(1)),
  STOREPAY_PASSWORD: optional(z.string().min(1)),
  /** This shop's StorePay store number — their `storeId`. */
  STOREPAY_STORE_ID: optional(z.string().min(1)),
  STOREPAY_CALLBACK_SECRET: optional(z.string().min(32)),

  /**
   * Transactional email (order receipts, admin login codes) via Resend's HTTP
   * API — the bare `re_...` key from the Resend dashboard. Unset means sending
   * is silently skipped — see lib/server/email/resend.ts — so an unfinished
   * mail setup never blocks checkout or settlement.
   */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Three33 Barbershop <noreply@localhost>'),

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
