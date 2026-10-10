import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '~/db'

/** A transaction handle, or the db itself — for helpers that work in both. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type Executor = typeof db | Tx

/** The Ulaanbaatar calendar day of a timestamptz column, as a date. */
export function localDay(column: AnyPgColumn): SQL<string> {
  return sql<string>`((${column} at time zone 'UTC') + interval '8 hours')::date`
}
