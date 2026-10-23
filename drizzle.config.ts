import { globSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

/** The local D1's SQLite file, for `npm run db:studio` (exists after db:migrate). */
const localD1 = globSync('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite')[0]

/**
 * Generates the D1 (SQLite) migrations from src/db/schema.ts:
 *
 *   npm run db:generate                 after editing the schema
 *   npm run db:migrate                  apply to the local D1 (wrangler dev)
 *   npm run db:migrate:remote           apply to the deployed D1
 *
 *   npm run db:studio                   browse the local D1
 *
 * drizzle-kit only writes the SQL; wrangler applies it (wrangler.jsonc
 * `migrations_dir` points here) and records what ran in d1_migrations.
 *
 * Triggers cannot be expressed in the schema, so they live in hand-written
 * migrations created with `npx drizzle-kit generate --custom --name <name>`.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  casing: 'snake_case',
  ...(localD1 ? { dbCredentials: { url: localD1 } } : {}),
  verbose: true,
  strict: true,
})
