import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { loadDotEnv } from '~/lib/load-dot-env'
import * as schema from './schema'

// Import-time, not call-time: ESM hoists imports, so a script that called this
// itself would already have run this module body and read process.env below.
loadDotEnv()

/**
 * Two drivers, one schema.
 *
 * `postgres` — a real server, via postgres.js. What production runs.
 * `pglite`   — Postgres compiled to WASM, running in-process against a local
 *              directory. Not a different database: the same Postgres engine,
 *              so the same SQL, the same types, the same migrations. It exists
 *              so development doesn't block on a Docker install.
 *
 * Selected by DB_DRIVER, defaulting to pglite when DATABASE_URL is absent.
 */
export type DbDriver = 'postgres' | 'pglite'

export const driver: DbDriver =
  (process.env.DB_DRIVER as DbDriver | undefined) ??
  (process.env.DATABASE_URL ? 'postgres' : 'pglite')

/**
 * PGlite in production is always a mistake, and a quiet one.
 *
 * It writes to the container's own filesystem, which does not survive a
 * redeploy. Forget to set DATABASE_URL on a host and the app boots perfectly,
 * serves an empty catalogue, accepts orders into a database that evaporates on
 * the next push, and reports nothing wrong anywhere.
 *
 * Refuse instead. A container that will not start is a five-minute fix; the
 * alternative is losing real orders and not knowing until a customer asks.
 */
if (process.env.NODE_ENV === 'production' && driver === 'pglite') {
  throw new Error(
    'Refusing to run on PGlite in production — its storage is ephemeral and ' +
      'orders written to it are lost on redeploy. Set DATABASE_URL (and ' +
      'DB_DRIVER=postgres) to a real Postgres server.',
  )
}

/** Where PGlite keeps its data. Gitignored. */
export const PGLITE_DIR = process.env.PGLITE_DIR ?? '.pglite'

/**
 * Vite dev reloads modules on every edit; without this the pool — or the PGlite
 * instance, which holds an exclusive lock on its directory — would be recreated
 * on each edit until connections (or the lock) ran out.
 */
const globalForDb = globalThis as unknown as {
  __uppercutDb?: Db
}

/**
 * Both drivers produce a `PgDatabase` with the same query API; only the result
 * metadata generic differs. Naming one of them as the app-wide type keeps every
 * call site free of driver unions, at the cost of one cast here.
 */
export type Db = PostgresJsDatabase<typeof schema>

function createDb(): Db {
  if (driver === 'pglite') {
    return drizzlePglite(new PGlite(PGLITE_DIR), {
      schema,
      casing: 'snake_case',
    }) as unknown as Db
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set (copy .env.example to .env)')
  }

  const client = postgres(url, {
    max: 10,
    // Transactions in this app do SELECT ... FOR UPDATE on variant rows; a
    // stuck client holding those locks is worse than a failed request.
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return drizzlePostgres(client, { schema, casing: 'snake_case' })
}

export const db: Db = globalForDb.__uppercutDb ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__uppercutDb = db
}

export { schema }
