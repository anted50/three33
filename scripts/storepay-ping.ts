/**
 * Connectivity check: fetch one StorePay access token and report when it
 * expires. Mirrors qpay-ping.ts.
 *
 * Read-only — it creates nothing. Safe to run against production credentials,
 * but do not put it in a loop: same token-per-validity-window discipline as
 * QPay.
 */
import { env } from '~/lib/server/env'
import { StorepayClient } from '~/lib/server/payments/storepay/client'
import { storepayTokenResponse } from '~/lib/server/payments/storepay/types'

async function main() {
  const {
    STOREPAY_BASE_URL,
    STOREPAY_APP_USERNAME,
    STOREPAY_APP_PASSWORD,
    STOREPAY_USERNAME,
    STOREPAY_PASSWORD,
    STOREPAY_STORE_ID,
  } = env

  if (
    !STOREPAY_BASE_URL ||
    !STOREPAY_APP_USERNAME ||
    !STOREPAY_APP_PASSWORD ||
    !STOREPAY_USERNAME ||
    !STOREPAY_PASSWORD ||
    !STOREPAY_STORE_ID
  ) {
    console.error('STOREPAY_* is not fully set — see .env.example')
    process.exit(1)
  }

  console.log(`base url : ${STOREPAY_BASE_URL}`)
  console.log(`store id : ${STOREPAY_STORE_ID}`)
  console.log(`app user : ${STOREPAY_APP_USERNAME}`)
  console.log(`user     : ${STOREPAY_USERNAME}`)
  console.log('')

  const authOrigin = new URL(STOREPAY_BASE_URL).origin
  const basic = Buffer.from(
    `${STOREPAY_APP_USERNAME}:${STOREPAY_APP_PASSWORD}`,
  ).toString('base64')

  const tokenUrl = new URL(`${authOrigin}/merchant-uaa/oauth/token`)
  tokenUrl.searchParams.set('grant_type', 'password')
  tokenUrl.searchParams.set('username', STOREPAY_USERNAME)
  tokenUrl.searchParams.set('password', STOREPAY_PASSWORD)

  const response = await fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  })

  const text = await response.text()
  if (!response.ok) {
    console.error(`FAILED ${response.status}: ${text.slice(0, 500)}`)
    process.exit(1)
  }

  const parsed = storepayTokenResponse.safeParse(JSON.parse(text))
  if (!parsed.success) {
    console.error('Token response did not match the expected shape:')
    console.error(parsed.error.message)
    process.exit(1)
  }

  const { access_token, expires_in, refresh_token } = parsed.data
  console.log('token   : OK')
  console.log(`  length        ${access_token.length}`)
  console.log(`  refresh       ${refresh_token ? 'present' : 'absent'}`)
  console.log(`  expires_in    ${expires_in}s`)

  // Confirms StorepayClient's own caching path works, not just a raw fetch.
  const client = new StorepayClient({
    baseUrl: STOREPAY_BASE_URL,
    appUsername: STOREPAY_APP_USERNAME,
    appPassword: STOREPAY_APP_PASSWORD,
    username: STOREPAY_USERNAME,
    password: STOREPAY_PASSWORD,
  })
  await client
    .request('/merchant/loanList/2020-01-01/2020-01-02')
    .catch(() => {})
  console.log('client  : constructed and reached the API')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('storepay-ping failed:', error)
    process.exit(1)
  })
