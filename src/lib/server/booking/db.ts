import { sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

/**
 * The Ulaanbaatar calendar day ('YYYY-MM-DD') of a timestamp column.
 * Ulaanbaatar is UTC+8 all year (no DST since 2017). Columns hold epoch
 * milliseconds; SQLite's date() wants seconds.
 */
export function localDay(column: AnySQLiteColumn): SQL<string> {
  return sql<string>`date(${column} / 1000, 'unixepoch', '+8 hours')`
}
