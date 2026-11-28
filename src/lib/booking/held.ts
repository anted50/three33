/**
 * The customer's last booking, remembered in this browser.
 *
 * The token in the booking URL is the customer's only key to it. Keeping it
 * here too means a closed tab isn't a lost booking, and lets a HOLD_EXISTS
 * answer ("you already have a booking waiting for payment") link straight to
 * that booking. The email is kept only to say where the confirmation went —
 * the status endpoint deliberately doesn't return it.
 *
 * Storage can be missing or throw (private mode, blocked site data); every
 * caller copes with null.
 */

export interface HeldBooking {
  bookingNo: string
  token: string
  email?: string
}

const STORAGE_KEY = 'three33.booking'

export function rememberBooking(booking: HeldBooking): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(booking))
  } catch (error) {
    // Not fatal: the link in the URL still works.
    console.warn('Could not remember the booking in this browser', error)
  }
}

export function heldBooking(): HeldBooking | null {
  let value: unknown
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    value = JSON.parse(raw)
  } catch {
    // Storage blocked, or a value no longer JSON: nothing remembered.
    return null
  }
  return isHeldBooking(value) ? value : null
}

/** Storage is outside this code's control: check the shape before trusting it. */
function isHeldBooking(value: unknown): value is HeldBooking {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.bookingNo !== 'string') return false
  if (typeof record.token !== 'string') return false
  return record.email === undefined || typeof record.email === 'string'
}
