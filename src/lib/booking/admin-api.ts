import { apiCall } from './api'

/**
 * Admin pages' client for /api/v1/admin/* (booking: services, schedule,
 * appointments, fee). Same-origin, so the admin's `uc_session` cookie — the
 * one /admin signs in with — goes along and `adminOnly` lets it through.
 * Each route file documents its endpoint; shapes here mirror those docs.
 */

export interface AdminService {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  /** Mungu, paid at the shop. Null = not shown. */
  price: number | null
  isActive: boolean
  sortOrder: number
}

export type ServiceInput = {
  name: string
  description?: string | null
  durationMinutes: number
  price?: number | null
  isActive?: boolean
  sortOrder?: number
}

export type AppointmentStatus = 'pending' | 'booked' | 'cancelled'

export interface Appointment {
  id: string
  bookingNo: string
  source: 'online' | 'admin'
  status: AppointmentStatus
  serviceId: string | null
  serviceName: string
  durationMinutes: number
  startsAt: string
  endsAt: string
  customerName: string
  customerPhone: string
  customerEmail: string | null
  note: string | null
  bookingFee: number
  paidAt: string | null
  expiresAt: string | null
  confirmationSentAt: string | null
  cancelledAt: string | null
  createdAt: string
}

export interface ScheduleDay {
  date: string
  windows: { id: string; startsAt: string; endsAt: string }[]
  appointments: { id: string; bookingNo: string; status: AppointmentStatus; startsAt: string; endsAt: string; serviceName: string; customerName: string }[]
}

export type ScheduleEntry =
  | { from: string; to: string; weekdays?: number[]; start: string; end: string }
  | { from: string; to: string; weekdays?: number[]; closed: true }

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const adminBookingApi = {
  services: () => apiCall<AdminService[]>('/admin/services'),
  createService: (input: ServiceInput) => apiCall<AdminService>('/admin/services', json('POST', input)),
  updateService: (id: string, patch: Partial<ServiceInput>) => apiCall<AdminService>(`/admin/services/${id}`, json('PATCH', patch)),

  bookingFee: () => apiCall<{ bookingFee: number | null }>('/admin/booking-fee'),
  setBookingFee: (bookingFee: number) => apiCall<{ bookingFee: number }>('/admin/booking-fee', json('PUT', { bookingFee })),

  appointments: (from: string, to: string, status?: AppointmentStatus) =>
    apiCall<Appointment[]>(`/admin/appointments?${new URLSearchParams({ from, to, ...(status ? { status } : {}) })}`),
  createAppointment: (input: {
    serviceId: string
    startsAt: string
    customerName: string
    customerPhone: string
    customerEmail?: string | null
    note?: string | null
  }) => apiCall<Appointment>('/admin/appointments', json('POST', input)),
  reschedule: (id: string, startsAt: string) => apiCall<Appointment>(`/admin/appointments/${id}/reschedule`, json('POST', { startsAt })),
  cancel: (id: string) => apiCall<Appointment>(`/admin/appointments/${id}/cancel`, json('POST', {})),
  resendConfirmation: (id: string) =>
    apiCall<{ outcome: 'sent' | 'mail_disabled' | 'no_email' }>(`/admin/appointments/${id}/resend-confirmation`, json('POST', {})),

  schedule: (from: string, to: string) => apiCall<ScheduleDay[]>(`/admin/schedule?${new URLSearchParams({ from, to })}`),
  applySchedule: (entries: ScheduleEntry[]) => apiCall<ScheduleDay[]>('/admin/schedule', json('PUT', { entries })),
  deleteWindow: (id: string) => apiCall<null>(`/admin/schedule/${id}`, { method: 'DELETE' }),
}

/** An Ulaanbaatar wall-clock time as the API's ISO instant: 2026-10-29 + 14:30. */
export function ubInstant(date: string, time: string): string {
  return `${date}T${time}:00+08:00`
}
