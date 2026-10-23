/**
 * Grants admin access to an email address — the only way to create an admin,
 * deliberately: there is no signup form, so an OTP can only ever log someone
 * into an account that already exists. See docs/email-otp.md.
 *
 * Usage:
 *   npm run admin:add -- you@three33barber.com "Your Name"             local D1
 *   npm run admin:add -- you@three33barber.com "Your Name" --remote    production D1
 *   npm run admin:add -- you@three33barber.com "Your Name" --staging   staging D1
 *
 * Idempotent: promotes the user if the email already exists (updating the
 * name if one is given), otherwise creates it with role='admin'. One upsert,
 * run through wrangler, so --remote uses your own `wrangler login`.
 */
import { d1Execute, literal } from './lib/wrangler-d1'

const args = process.argv.slice(2)
const target = args.includes('--staging') ? 'staging' : args.includes('--remote') ? 'production' : 'local'
const [email, name] = args.filter((a) => !a.startsWith('--'))

if (!email || !/^[^\s@']+@[^\s@']+$/.test(email)) {
  console.error('Usage: npm run admin:add -- <email> [name] [--remote | --staging]')
  process.exit(1)
}

const normalised = email.trim().toLowerCase()

d1Execute(
  `insert into users (id, email, name, role)
   values (${literal(crypto.randomUUID())}, ${literal(normalised)}, ${literal(name ?? normalised)}, 'admin')
   on conflict (email) do update set role = 'admin'${name ? `, name = ${literal(name)}` : ''}`,
  { target },
)

console.log(`admin:add: ${normalised} is an admin (${target} D1)`)
