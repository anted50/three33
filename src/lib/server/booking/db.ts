import { sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { db } from '~/db'

/**
 * The handle read helpers accept. Only ever `db` now — D1 has no transaction
 * handles to pass around (see src/db/atomic.ts) — but kept as a parameter so
 * the helpers read the same way they always have.
 */
export type Executor = typeof db

/**
 * The Ulaanbaatar calendar day ('YYYY-MM-DD') of a timestamp column.
 * Ulaanbaatar is UTC+8 all year (no DST since 2017). Columns hold epoch
 * milliseconds; SQLite's date() wants seconds.
 */
export function localDay(column: AnySQLiteColumn): SQL<string> {
  return sql<string>`date(${column} / 1000, 'unixepoch', '+8 hours')`
}
