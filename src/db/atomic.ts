import { type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { isGuardFailure } from '~/lib/server/api/db-errors'
import { db } from './index'
import { batchGuards } from './schema'

/**
 * Atomic multi-statement writes on D1.
 *
 * D1 has no interactive transactions: a request cannot BEGIN, read, decide
 * and COMMIT. What it has is the batch — a list of statements D1 runs in one
 * implicit transaction, in order, with nothing else interleaved. Either every
 * statement applies or none does.
 *
 * So code that used to be
 *
 *   db.transaction(async (tx) => {
 *     const row = await tx.select()...for('update')   // lock
 *     if (!ok(row)) throw ...                         // decide
 *     await tx.update(...); await tx.insert(...)      // write
 *   })
 *
 * becomes
 *
 *   const row = await db.select()...                  // read (no lock)
 *   if (!ok(row)) throw ...                           // decide, for a clear error
 *   await atomic([
 *     guard(sql`<what ok(row) checked, in SQL>`, 'CODE'),   // re-check, atomically
 *     db.update(...), db.insert(...),                 // write
 *   ])
 *
 * The read-and-decide gives the normal, specific error. The guard covers the
 * window between that read and the batch: if another request changed the row
 * in between, the guard aborts the whole batch with `CODE`, which reaches the
 * client as a 409 with that code (api/db-errors.ts). Rows a later statement
 * references are given ids in JS up front (schema ids are crypto.randomUUID),
 * since a batch cannot feed one statement's RETURNING into the next.
 *
 * Unique indexes, CHECK constraints and the no-overlap triggers still abort
 * a batch exactly as they rolled back a Postgres transaction.
 */

export type Statement = BatchItem<'sqlite'>

/**
 * Runs statements as one atomic batch. Returns each statement's result, in
 * order (`unknown[]` — callers that need a RETURNING row pick it out by index).
 * An empty list is a no-op, so callers can build the list conditionally.
 */
export async function atomic(statements: ReadonlyArray<Statement | null | undefined | false>): Promise<unknown[]> {
  const list = statements.filter((s): s is Statement => Boolean(s))
  if (list.length === 0) return []
  return db.batch(list as [Statement, ...Statement[]])
}

/**
 * A batch statement that aborts the batch with `code` unless `condition`
 * holds at that point in the batch. Put guards first, so they see the state
 * before this batch's own writes.
 *
 * `code` must be an UPPER_SNAKE API error code; it becomes the 409's `code`.
 */
export function guard(condition: SQL, code: string): Statement {
  if (!/^[A-Z0-9_]+$/.test(code)) throw new Error(`guard code must be UPPER_SNAKE: ${code}`)
  // A query builder, not db.run(sql`...`): Drizzle's D1 batch cannot bind
  // parameters on raw statements (it has no prepared statement for them).
  return db.insert(batchGuards).select(sql`select ${`guard:${code}`} where not (${condition})`)
}

/** `exists (<query>)` — for guards over a Drizzle select. */
export function exists(query: SQLWrapper): SQL {
  // No parentheses of our own: Drizzle already wraps an embedded select, and
  // SQLite rejects `exists ((select ...))`.
  return sql`exists ${query}`
}

/**
 * A guard that the most recent statement in the batch changed at least one
 * row — for conditional UPDATEs such as "decrement stock where enough is
 * left" or "move status from pending where still pending", whose WHERE clause
 * is the check. Must directly follow that statement.
 */
export function changed(code: string): Statement {
  return guard(sql`changes() > 0`, code)
}

/**
 * Re-runs `attempt` when its batch was stopped by the guard `code` — for
 * writes computed from state that another request may have changed in the
 * moment between reading it and the batch running (two payments landing on
 * one sale at once, say). Each attempt must re-read what it depends on.
 * After `tries` attempts the guard failure is thrown as is (a 409).
 */
export async function retryOnGuard<T>(code: string, attempt: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt()
    } catch (error) {
      if (i >= tries || !isGuardFailure(error, code)) throw error
    }
  }
}
