import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from './schema'

/**
 * The Drizzle client over a D1 binding. Separate from ./index so Node-side
 * code — scripts (via wrangler's getPlatformProxy) and integration tests —
 * can build one from a binding of their own without importing
 * `cloudflare:workers`, which only exists inside workerd.
 */
export type Db = DrizzleD1Database<typeof schema>

export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema, casing: 'snake_case' })
}
