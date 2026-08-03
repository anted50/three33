/**
 * Applies the generated SQL migrations to whichever driver is configured.
 *
 * `drizzle-kit migrate` only speaks to a real Postgres server, so it can't
 * drive PGlite. The migrations themselves are identical either way — this is
 * just the runner.
 */
import { db, driver } from '~/db'

async function main() {
  console.log(`migrate: driver=${driver}`)

  if (driver === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(db as never, { migrationsFolder: './drizzle' })
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator')
    await migrate(db as never, { migrationsFolder: './drizzle' })
  }

  console.log('migrate: done')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('migrate: failed', error)
    process.exit(1)
  })
