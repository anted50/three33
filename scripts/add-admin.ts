/**
 * Grants admin access to an email address — the only way to create an admin,
 * deliberately: there is no signup form, so an OTP can only ever log someone
 * into an account that already exists. See docs/email-otp.md.
 *
 * Usage:
 *   npm run admin:add you@three33barber.com "Your Name"
 *
 * Idempotent: promotes the user if the email already exists (updating the
 * name if one is given), otherwise creates it with role='admin'.
 */
import { eq } from 'drizzle-orm'
import { assertNoDevServer } from '~/lib/server/pglite-guard'
import { users } from '~/db/schema'

// Before importing ~/db — see scripts/migrate.ts.
await assertNoDevServer()
const { db } = await import('~/db')

async function main() {
  const [email, name] = process.argv.slice(2)

  if (!email || !email.includes('@')) {
    console.error('Usage: npm run admin:add <email> [name]')
    process.exit(1)
  }

  const normalised = email.trim().toLowerCase()

  const [existing] = await db
    .select({ id: users.id, role: users.role, name: users.name })
    .from(users)
    .where(eq(users.email, normalised))
    .limit(1)

  if (existing) {
    await db
      .update(users)
      .set({ role: 'admin', ...(name ? { name } : {}) })
      .where(eq(users.id, existing.id))
    console.log(
      `admin:add: promoted ${normalised} (was role=${existing.role}) to admin`,
    )
    return
  }

  await db.insert(users).values({
    email: normalised,
    name: name ?? normalised,
    role: 'admin',
  })
  console.log(`admin:add: created ${normalised} as admin`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('admin:add: failed', error)
    process.exit(1)
  })
