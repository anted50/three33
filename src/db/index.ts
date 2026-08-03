import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { loadDotEnv } from '~/lib/load-dot-env'
import * as schema from './schema'

// Import-time, not call-time: ESM hoists imports, so a script that called this
// itself would already have run this module body and thrown below.
loadDotEnv()

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set (copy .env.example to .env)')
}

/**
 * Vite dev reloads modules on every edit; without this the pool would be
 * recreated each time and leak connections until Postgres refuses new ones.
 */
const globalForDb = globalThis as unknown as {
  __uppercutClient?: ReturnType<typeof postgres>
}

const client =
  globalForDb.__uppercutClient ??
  postgres(url, {
    max: 10,
    // Transactions in this app do SELECT ... FOR UPDATE on variant rows; a
    // stuck client holding those locks is worse than a failed request.
    idle_timeout: 20,
    connect_timeout: 10,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__uppercutClient = client
}

export const db = drizzle(client, { schema, casing: 'snake_case' })
export { schema }
export type Db = typeof db

/** Transaction handle type — for functions that must run inside a caller's tx. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
