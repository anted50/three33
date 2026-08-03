/**
 * Connectivity check: fetch one QPay access token and report when it expires.
 *
 * Read-only — it creates nothing. Safe to run against production credentials,
 * but do not put it in a loop: QPay's integration notes are explicit that the
 * token must be fetched once per validity window, not per request.
 */
import { env } from '~/lib/server/env'
import { QpayClient, resolveExpiry } from '~/lib/server/payments/qpay/client'
import { qpayTokenResponse } from '~/lib/server/payments/qpay/types'

async function main() {
  console.log(`base url : ${env.QPAY_BASE_URL}`)
  console.log(`username : ${env.QPAY_USERNAME}`)
  console.log(`invoice  : ${env.QPAY_INVOICE_CODE}`)
  console.log('')

  const basic = Buffer.from(
    `${env.QPAY_USERNAME}:${env.QPAY_PASSWORD}`,
  ).toString('base64')

  const response = await fetch(`${env.QPAY_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  })

  const text = await response.text()
  if (!response.ok) {
    console.error(`FAILED ${response.status}: ${text.slice(0, 500)}`)
    process.exit(1)
  }

  const parsed = qpayTokenResponse.safeParse(JSON.parse(text))
  if (!parsed.success) {
    console.error('Token response did not match the expected shape:')
    console.error(parsed.error.message)
    process.exit(1)
  }

  const { access_token, expires_in, refresh_token } = parsed.data
  console.log('token   : OK')
  console.log(`  length        ${access_token.length}`)
  console.log(`  refresh       ${refresh_token ? 'present' : 'absent'}`)
  console.log(`  expires_in    ${expires_in}`)
  console.log(
    `  interpreted   ${new Date(resolveExpiry(expires_in)).toISOString()} (incl. 60s safety margin)`,
  )

  // Confirms QpayClient's own caching path works, not just a raw fetch.
  const client = new QpayClient({
    baseUrl: env.QPAY_BASE_URL,
    username: env.QPAY_USERNAME,
    password: env.QPAY_PASSWORD,
  })
  await client.request('/auth/token', { method: 'POST' }).catch(() => {})
  console.log('client  : constructed and reached the API')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('qpay-ping failed:', error)
    process.exit(1)
  })
