import { ApiError } from './errors'

/**
 * Turns a D1 (SQLite) constraint violation into an ApiError.
 *
 * The database is the real guard for anything two requests can race on —
 * overlapping bookings, a fee paid twice, a duplicate email — so those
 * failures are expected outcomes, not bugs, and deserve a proper 409/400
 * instead of a 500.
 *
 * SQLite has no SQLSTATE codes or constraint-name fields; the only signal is
 * the message, which D1 passes through and Drizzle wraps in `cause`:
 *
 *   UNIQUE constraint failed: users.email            (columns, not index name)
 *   CHECK constraint failed: users_role_check        (constraint name)
 *   FOREIGN KEY constraint failed
 *   NOT NULL constraint failed: users.name
 *   appointments_no_overlap                          (a trigger's RAISE message)
 *   guard:SALE_NOT_OPEN                              (a batch guard, src/db/atomic.ts)
 *
 * Pure: no database import, so it is unit tested directly.
 */

/**
 * Stable codes and readable messages for the violations users can hit. Unique
 * violations are keyed by their column list, since that is all SQLite reports.
 */
const KNOWN: Record<string, [code: string, message: string]> = {
  appointments_no_overlap: ['TIME_TAKEN', 'That time overlaps another booking'],
  barber_shifts_no_overlap: ['SHIFT_OVERLAP', 'Shifts overlap each other'],
  'users.email': ['EMAIL_TAKEN', 'That email already belongs to an account'],
  'barbers.slug': ['SLUG_TAKEN', 'Another barber already uses that slug'],
  'barbers.user_id': ['ALREADY_BARBER', 'That account is already a barber'],
  'locations.slug': ['SLUG_TAKEN', 'Another location already uses that slug'],
  'barber_terms.barber_id, barber_terms.effective_from': [
    'TERMS_EXIST',
    'Terms already start at that moment',
  ],
  'barber_sales.appointment_id': [
    'CHECKOUT_EXISTS',
    'This appointment already has an open checkout',
  ],
}

export type ViolationKind = 'unique' | 'check' | 'foreign_key' | 'not_null' | 'trigger' | 'guard'

export interface DbViolation {
  kind: ViolationKind
  /** Column list (unique, not null), constraint name (check), trigger message, or guard code. */
  target: string | null
}

const PATTERNS: Array<[ViolationKind, RegExp]> = [
  ['guard', /guard:([A-Z0-9_]+)/],
  ['unique', /UNIQUE constraint failed: ([\w.]+(?:, [\w.]+)*)/],
  ['check', /CHECK constraint failed: (\w+)/],
  ['foreign_key', /FOREIGN KEY constraint failed()/],
  ['not_null', /NOT NULL constraint failed: ([\w.]+)/],
  ['trigger', /(appointments_no_overlap|barber_shifts_no_overlap)/],
]

export function findDbViolation(error: unknown): DbViolation | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : ''
    for (const [kind, pattern] of PATTERNS) {
      const match = pattern.exec(message)
      if (match) return { kind, target: match[1] || null }
    }
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/** True when `error` is a batch guard that aborted with `code` (src/db/atomic.ts). */
export function isGuardFailure(error: unknown, code: string): boolean {
  const violation = findDbViolation(error)
  return violation?.kind === 'guard' && violation.target === code
}

/** True when `error` is a unique violation on exactly these columns (e.g. 'products.slug'). */
export function isUniqueViolation(error: unknown, columns: string): boolean {
  const violation = findDbViolation(error)
  return violation?.kind === 'unique' && violation.target === columns
}

const BY_KIND: Record<ViolationKind, [status: number, code: string, message: string]> = {
  unique: [409, 'CONFLICT', 'Already exists'],
  trigger: [409, 'CONFLICT', 'Conflicts with existing data'],
  foreign_key: [409, 'IN_USE', 'Refers to missing data, or is still in use'],
  check: [400, 'INVALID', 'Breaks a data rule'],
  not_null: [400, 'INVALID', 'A required value is missing'],
  // Replaced below: a guard's code is the API error code.
  guard: [409, 'CONFLICT', 'Something changed while this was being saved — try again'],
}

export function apiErrorFromDb(error: unknown): ApiError | null {
  const violation = findDbViolation(error)
  if (!violation) return null

  const [status, fallbackCode, fallbackMessage] = BY_KIND[violation.kind]

  if (violation.kind === 'guard') {
    return new ApiError(status, violation.target ?? fallbackCode, fallbackMessage)
  }

  const known = violation.target ? KNOWN[violation.target] : undefined
  return new ApiError(
    status,
    known?.[0] ?? fallbackCode,
    known?.[1] ?? fallbackMessage,
    violation.target ? { constraint: violation.target } : undefined,
  )
}
