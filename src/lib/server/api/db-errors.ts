import { ApiError } from './errors'

/**
 * Turns a Postgres constraint violation into an ApiError.
 *
 * The database is the real guard for anything two requests can race on —
 * overlapping bookings, a fee paid twice, a duplicate email — so those
 * failures are expected outcomes, not bugs, and deserve a proper 409/400
 * instead of a 500.
 *
 * Works for both drivers: postgres.js puts the name in `constraint_name`,
 * PGlite in `constraint`, and Drizzle wraps either in `cause`.
 */

/** Stable codes and readable messages for the constraints users can hit. */
const KNOWN: Record<string, [code: string, message: string]> = {
  appointments_no_overlap: ['TIME_TAKEN', 'That time overlaps another booking'],
  barber_shifts_no_overlap: ['SHIFT_OVERLAP', 'Shifts overlap each other'],
  users_email_key: ['EMAIL_TAKEN', 'That email already belongs to an account'],
  barbers_slug_key: ['SLUG_TAKEN', 'Another barber already uses that slug'],
  barbers_user_id_key: ['ALREADY_BARBER', 'That account is already a barber'],
  locations_slug_key: ['SLUG_TAKEN', 'Another location already uses that slug'],
  barber_terms_barber_effective_key: [
    'TERMS_EXIST',
    'Terms already start at that moment',
  ],
  barber_sales_appointment_key: [
    'CHECKOUT_EXISTS',
    'This appointment already has an open checkout',
  ],
}

const BY_SQLSTATE: Record<string, [status: number, code: string, message: string]> =
  {
    '23P01': [409, 'CONFLICT', 'Conflicts with existing data'], // exclusion
    '23505': [409, 'CONFLICT', 'Already exists'], // unique
    '23503': [409, 'IN_USE', 'Refers to missing data, or is still in use'], // FK
    '23514': [400, 'INVALID', 'Breaks a data rule'], // check
    '23502': [400, 'INVALID', 'A required value is missing'], // not null
  }

interface PgViolation {
  sqlstate: string
  constraint: string | null
}

export function findPgViolation(error: unknown): PgViolation | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as Record<string, unknown>
    if (typeof e.code === 'string' && e.code in BY_SQLSTATE) {
      const constraint = e.constraint ?? e.constraint_name ?? null
      return {
        sqlstate: e.code,
        constraint: typeof constraint === 'string' ? constraint : null,
      }
    }
    current = e.cause
  }
  return null
}

export function apiErrorFromDb(error: unknown): ApiError | null {
  const violation = findPgViolation(error)
  if (!violation) return null

  const [status, fallbackCode, fallbackMessage] = BY_SQLSTATE[violation.sqlstate]!
  const known = violation.constraint ? KNOWN[violation.constraint] : undefined

  return new ApiError(
    status,
    known?.[0] ?? fallbackCode,
    known?.[1] ?? fallbackMessage,
    violation.constraint ? { constraint: violation.constraint } : undefined,
  )
}
