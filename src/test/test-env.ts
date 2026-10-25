/**
 * Mock configuration for every test, unit and D1 alike — set before any app
 * module loads, so a test never depends on the .dev.vars / .env of whoever
 * runs it. CI has neither file: a module that validates its environment at
 * import (src/lib/server/env.ts) would otherwise throw there and nowhere else.
 *
 * Assigned outright, not defaulted: process.loadEnvFile (loadDotEnv) never
 * overrides a value that is already set, so local files can't leak in either.
 * Mock values only — nothing in a test may reach a real provider.
 */
const TEST_ENV: Record<string, string> = {
  APP_URL: 'http://localhost:3000',
  QPAY_BASE_URL: 'http://127.0.0.1:9',
  QPAY_USERNAME: 'test',
  QPAY_PASSWORD: 'test',
  QPAY_INVOICE_CODE: 'TEST',
  QPAY_CALLBACK_SECRET: 'test-qpay-callback-secret-0123456789abcdef',
  EMAIL_FROM: 'test@localhost',
  // Empty = unset (env.ts treats blank optional values as absent): no real
  // mail and no StorePay, whatever the local files say.
  RESEND_API_KEY: '',
  STOREPAY_BASE_URL: '',
  STOREPAY_APP_USERNAME: '',
  STOREPAY_APP_PASSWORD: '',
  STOREPAY_USERNAME: '',
  STOREPAY_PASSWORD: '',
  STOREPAY_STORE_ID: '',
  STOREPAY_CALLBACK_SECRET: '',
  JOBS_API_TOKEN: '',
}
for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value
