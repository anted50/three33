/**
 * The booking pages' client for /api/v1/public/* — the same JSON API an
 * outside booking page would use, so there is one contract, documented in the
 * route files. Browser-only: the booking routes render with `ssr: false`.
 *
 * Money is mungu; instants are ISO strings; dates are Ulaanbaatar YYYY-MM-DD.
 */

export interface BookableService {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  /** Paid at the shop. Null = not shown. */
  price: number | null
}

export interface BookingOptions {
  /** Null = online booking is off (no fee set yet). */
  bookingFee: number | null
  services: BookableService[]
}

export interface SlotDays {
  service: { id: string; name: string; durationMinutes: number }
  days: { date: string; slots: string[] }[]
}

export interface FeeInvoice {
  qrText: string
  /** Base64 PNG. */
  qrImage: string
  shortUrl: string | null
  links: { name: string; description: string; logo: string; link: string }[]
}

export interface NewBooking {
  serviceId: string
  startsAt: string
  customerName: string
  customerPhone: string
  customerEmail: string
  note?: string | null
}

export interface CreatedBooking {
  bookingNo: string
  token: string
  expiresAt: string
  startsAt: string
  endsAt: string
  service: string
  bookingFee: number
  invoice: FeeInvoice
}

export type BookingState = 'holding' | 'confirmed' | 'cancelled'

export interface BookingStatus {
  bookingNo: string
  state: BookingState
  service: string
  startsAt: string
  endsAt: string
  customerName: string
  bookingFee: number
  feePaid: boolean
  /** Only while holding. */
  expiresAt?: string
  invoice?: FeeInvoice | null
}

/** A failed call. Branch on `code` (TIME_TAKEN, HOLD_EXISTS, …), never on message. */
export class BookingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** One JSON call to /api/v1; errors become BookingApiError. Shared with admin-api.ts. */
export async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      // Every write must say JSON, bodiless DELETE included: it's the API's CSRF guard.
      headers: init?.method && init.method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new BookingApiError(0, 'NETWORK', 'No connection')
  }
  // 204 (a deleted window) has no body.
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new BookingApiError(res.status, error?.code ?? 'UNKNOWN', error?.message ?? res.statusText)
  }
  return body as T
}

const call = <T,>(path: string, init?: RequestInit) => apiCall<T>(`/public${path}`, init)

const tokenQuery = (token: string) => `?t=${encodeURIComponent(token)}`

export const bookingApi = {
  options: () => call<BookingOptions>('/booking-options'),

  slots: (serviceId: string, from: string, days: number) =>
    call<SlotDays>(`/slots?${new URLSearchParams({ serviceId, from, days: String(days) })}`),

  create: (input: NewBooking) => call<CreatedBooking>('/bookings', { method: 'POST', body: JSON.stringify(input) }),

  status: (bookingNo: string, token: string) =>
    call<BookingStatus>(`/bookings/${encodeURIComponent(bookingNo)}${tokenQuery(token)}`),

  /** Asks QPay (throttled server-side) whether the fee is paid. */
  check: (bookingNo: string, token: string) =>
    call<{ status: 'pending' | 'booked' | 'cancelled'; checked: boolean }>(
      `/bookings/${encodeURIComponent(bookingNo)}/check${tokenQuery(token)}`,
      { method: 'POST', body: '{}' },
    ),
}
