import { env } from 'cloudflare:workers'
import { createDb, type Db } from './client'
import * as schema from './schema'

/**
 * The app's database: Cloudflare D1, bound as `DB` in wrangler.jsonc.
 *
 * One client per isolate, built at module load. That is safe on Workers:
 * bindings are available at the top level, and a D1 binding is not a
 * connection — there is no pool to exhaust and nothing to close.
 *
 * Two things that are different from Postgres, and that the rest of the code
 * is written around:
 *
 *  - No interactive transactions. D1 rejects BEGIN, so `db.transaction()`
 *    must never be called. Multi-statement writes go through one atomic
 *    batch — see ./atomic.ts.
 *  - No row locks. SELECT ... FOR UPDATE does not exist; the condition a lock
 *    used to protect is re-checked inside the batch with guard().
 *
 * In tests `cloudflare:workers` is aliased to a stub whose env.DB is a local
 * D1 from wrangler's getPlatformProxy — see vitest.config.ts.
 */
export const db: Db = createDb(env.DB)

export type { Db }
export { schema }
