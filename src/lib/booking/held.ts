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

const KEY = 'three33.booking'

export function rememberBooking(booking: HeldBooking): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(booking))
  } catch {
    // Not fatal: the link in the URL still works.
  }
}

export function heldBooking(): HeldBooking | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    return typeof value?.bookingNo === 'string' && typeof value?.token === 'string' ? value : null
  } catch {
    return null
  }
}
