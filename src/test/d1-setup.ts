import { readdirSync, readFileSync } from 'node:fs'
import { afterAll } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { env } from '../node-shims/cloudflare-workers'

/**
 * Setup for *.d1.test.ts: a fresh, in-memory D1 per test file, with every
 * migration in drizzle/ applied — the same SQL `wrangler d1 migrations apply`
 * runs, so the tests exercise the real constraints and triggers.
 *
 * Runs before the test file's imports are evaluated, so ~/db picks this
 * binding up when it builds its client at module load. The mock config it
 * relies on comes from test-env.ts, listed first in vitest.config.ts.
 */

const proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false, remoteBindings: false, envFiles: [] })
const d1 = proxy.env.DB

const migrations = readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort()
for (const file of migrations) {
  const statements = readFileSync(`drizzle/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await d1.prepare(statement).run()
}

env.DB = d1

afterAll(() => proxy.dispose())
