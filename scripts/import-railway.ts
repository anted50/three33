/**
 * Turns a pg_dump of the old Railway Postgres into a SQL file for D1, keeping
 * only the rows worth keeping.
 *
 * Usage:
 *   npm run import:railway -- backups/railway-production-<date>.dump
 *   npx wrangler d1 execute DB --local --file backups/railway-import.sql
 *   npx wrangler d1 execute DB --remote --env staging --file backups/railway-import.sql
 *   npx wrangler d1 execute DB --remote --file backups/railway-import.sql
 *
 * Needs `pg_restore` (Homebrew's libpq has it; PG_RESTORE=/path overrides).
 * Writes backups/railway-import.sql (gitignored — it holds customer data).
 *
 * WHAT IS KEPT AND WHY. The Railway database was the test environment for
 * months, behind a public site; most of it is bots and testing:
 *
 *   kept     the catalogue (categories, products, variants, images) minus
 *            the test products below; the shop's settings; the admin users;
 *            the orders in KEEP_ORDERS with their lines and payments
 *   dropped  carts and cart_items — 11k+ guest carts, nearly all crawlers
 *            (3,349 created on a single day), and carts expire anyway;
 *            sessions and OTP codes — everyone signs in again; checkout
 *            attempts, admin invoices and stock movements — all from test
 *            orders; every booking table — empty, and the booking schema
 *            changed completely
 *
 * The rules are explicit lists rather than guesses, so they can be reviewed
 * and re-run on a fresh dump at cutover. Rows already in the target (the
 * admin who exists in D1) are skipped, not duplicated.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../src/db/schema'

/** Orders that look like real customers. Everything else in `orders` was a test. */
const KEEP_ORDERS = new Set([
  'UD-260913-KPNG', // a real customer (Songinokhairkhan address); never paid, expired
])

/** Products that were made for testing checkout. */
const TEST_PRODUCT_SLUGS = new Set(['test-item', 'test'])

/** Imported in this order, so every foreign key points at a row already there. */
const IMPORT_ORDER: Array<{ table: SQLiteTable; conflict?: 'ignore' | 'replace' }> = [
  // The admin already added to D1 (admin:add) wins over the old row.
  { table: schema.users, conflict: 'ignore' },
  { table: schema.categories },
  { table: schema.products },
  { table: schema.productVariants },
  { table: schema.productImages },
  // The shop's real delivery fee and threshold replace any defaults.
  { table: schema.settings, conflict: 'replace' },
  { table: schema.orders },
  { table: schema.orderItems },
  { table: schema.payments },
]

type Row = Record<string, string | null>

// --- reading the dump ------------------------------------------------------

function readDump(path: string): Record<string, Row[]> {
  const pgRestore =
    process.env.PG_RESTORE ??
    (existsSync('/opt/homebrew/opt/libpq/bin/pg_restore') ? '/opt/homebrew/opt/libpq/bin/pg_restore' : 'pg_restore')
  const sql = execFileSync(pgRestore, ['--data-only', '-f', '-', path], { encoding: 'utf8', maxBuffer: 1 << 30 })

  const tables: Record<string, Row[]> = {}
  let current: { name: string; cols: string[] } | null = null
  for (const line of sql.split('\n')) {
    if (!current) {
      const m = /^COPY public\.(\w+) \((.*)\) FROM stdin;$/.exec(line)
      if (m) {
        current = { name: m[1]!, cols: m[2]!.split(',').map((c) => c.trim()) }
        tables[current.name] = []
      }
    } else if (line === '\\.') {
      current = null
    } else {
      const values = line.split('\t').map(unescapeCopy)
      tables[current.name]!.push(Object.fromEntries(current.cols.map((c, i) => [c, values[i] ?? null])))
    }
  }
  return tables
}

/** One field of COPY's text format: \N is NULL, backslash escapes otherwise. */
function unescapeCopy(field: string): string | null {
  if (field === '\\N') return null
  return field.replace(/\\(?:([0-7]{1,3})|(.))/g, (_, octal: string | undefined, ch: string) => {
    if (octal) return String.fromCharCode(Number.parseInt(octal, 8))
    return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' } as Record<string, string>)[ch] ?? ch
  })
}

// --- the cleanup ------------------------------------------------------------

function clean(t: Record<string, Row[]>) {
  const products = (t.products ?? []).filter((p) => !TEST_PRODUCT_SLUGS.has(p.slug!))
  const productIds = new Set(products.map((p) => p.id))
  const variants = (t.product_variants ?? []).filter((v) => productIds.has(v.product_id))
  const orders = (t.orders ?? [])
    .filter((o) => KEEP_ORDERS.has(o.order_no!))
    // Carts are not imported, so nothing to point at.
    .map((o): Row => ({ ...o, cart_id: null }))
  const orderIds = new Set(orders.map((o) => o.id))

  return {
    users: (t.users ?? []).filter((u) => u.role === 'admin'),
    categories: t.categories ?? [],
    products,
    product_variants: variants,
    product_images: (t.product_images ?? []).filter((i) => productIds.has(i.product_id)),
    settings: t.settings ?? [],
    orders,
    order_items: (t.order_items ?? []).filter((i) => orderIds.has(i.order_id)),
    payments: (t.payments ?? []).filter((p) => orderIds.has(p.order_id)),
  } as Record<string, Row[]>
}

// --- writing D1 SQL ----------------------------------------------------------

/** "2026-08-24 11:32:10.123456+00" -> epoch milliseconds. */
function toMillis(value: string): number {
  const iso = value
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Unreadable timestamp: ${value}`)
  return ms
}

function literal(value: string | null, columnType: string): string {
  if (value === null) return 'NULL'
  switch (columnType) {
    case 'SQLiteTimestamp':
      return String(toMillis(value))
    case 'SQLiteBoolean':
      return value === 't' ? '1' : '0'
    case 'SQLiteInteger':
      if (!/^-?\d+$/.test(value)) throw new Error(`Not an integer: ${value}`)
      return value
    default: // text, enums, JSON (stored as its text)
      return `'${value.replaceAll("'", "''")}'`
  }
}

function insertsFor(table: SQLiteTable, rows: Row[], conflict?: 'ignore' | 'replace'): string[] {
  const columns = Object.values(getTableColumns(table))
  const verb = conflict === 'ignore' ? 'INSERT OR IGNORE' : conflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT'
  return rows.map((row) => {
    const present = columns.filter((c) => c.name in row)
    const names = present.map((c) => `"${c.name}"`).join(', ')
    const values = present.map((c) => literal(row[c.name] ?? null, c.columnType)).join(', ')
    return `${verb} INTO "${getTableName(table)}" (${names}) VALUES (${values});`
  })
}

// --- main ---------------------------------------------------------------------

const dumpPath = process.argv[2]
const outFlag = process.argv.indexOf('--out')
const outPath = outFlag >= 0 ? process.argv[outFlag + 1]! : 'backups/railway-import.sql'
if (!dumpPath || !existsSync(dumpPath)) {
  console.error('Usage: npm run import:railway -- <pg_dump file> [--out <sql file>]')
  process.exit(1)
}

const source = readDump(dumpPath)
const kept = clean(source)

const lines = [
  `-- Generated by scripts/import-railway.ts from ${dumpPath} on ${new Date().toISOString()}.`,
  '-- Contains customer data: keep it out of git (backups/ is ignored).',
]
for (const { table, conflict } of IMPORT_ORDER) {
  const name = getTableName(table)
  lines.push(...insertsFor(table, kept[name] ?? [], conflict))
}
writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 })

console.log('import:railway — rows kept / in the dump')
for (const { table } of IMPORT_ORDER) {
  const name = getTableName(table)
  console.log(`  ${name.padEnd(18)} ${String(kept[name]?.length ?? 0).padStart(5)} / ${source[name]?.length ?? 0}`)
}
const skipped = Object.keys(source).filter((name) => !IMPORT_ORDER.some(({ table }) => getTableName(table) === name) && source[name]!.length > 0)
console.log(`  not imported:      ${skipped.map((n) => `${n} (${source[n]!.length})`).join(', ')}`)
console.log(`wrote ${outPath}`)
