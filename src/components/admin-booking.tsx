import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { BookingApiError } from '~/lib/booking/api'
import { adminBookingApi, ubInstant } from '~/lib/booking/admin-api'
import type { AdminService, Appointment, ScheduleDay } from '~/lib/booking/admin-api'
import { dayTitle, formatDuration, localDateOf, slotTime, todayUb } from '~/lib/booking/calendar'
import { clearValidity, localizeValidity } from '~/lib/form-messages'

/** Pieces the admin booking pages share: the add/reschedule dialogs and labels. */

export const APPOINTMENT_LABEL = { booked: 'Баталгаажсан', cancelled: 'Цуцалсан', pending: 'Төлбөр хүлээж буй' } as const
const APPOINTMENT_TONE = { booked: 'done', cancelled: 'dead', pending: 'wait' } as const

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PHONE_DIGITS = /^\d{8}$/

export function AppointmentBadge({ status }: { status: Appointment['status'] }) {
  return (
    <span className="badge2" data-tone={APPOINTMENT_TONE[status]}>
      {APPOINTMENT_LABEL[status]}
    </span>
  )
}

export function SourceBadge({ source }: { source: Appointment['source'] }) {
  return (
    <span className="badge2" data-tone={source === 'online' ? 'blue' : undefined}>
      {source === 'online' ? 'Онлайн' : 'Гараар'}
    </span>
  )
}

/** Turns API failures into the sentence an admin needs. */
export function bookingErrorText(err: unknown): string {
  if (err instanceof BookingApiError) {
    if (err.code === 'NETWORK') return 'Холболт тасарлаа. Интернэтээ шалгаад дахин оролдоно уу.'
    if (err.status === 401) return 'Нэвтрэх хугацаа дууссан — дахин нэвтэрнэ үү.'
    if (err.code === 'TIME_TAKEN') return 'Энэ цаг өөр захиалгатай давхцаж байна.'
    if (err.code === 'NOT_BOOKED') return 'Зөвхөн баталгаажсан захиалгад үйлдэл хийнэ.'
    if (err.status === 404) return 'Олдсонгүй (идэвхгүй үйлчилгээ байж магадгүй).'
    if (err.code === 'VALIDATION') return 'Мэдээлэл буруу байна — талбаруудаа шалгана уу.'
    return err.message
  }
  return 'Алдаа гарлаа. Дахин оролдоно уу.'
}

/**
 * The booking pages' errorComponent: a loader that failed (no connection, a
 * session that ran out) says why in Mongolian and offers a retry, instead of
 * the router's English default.
 */
export function BookingLoadFailed({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <section className="adm__card adm__pad">
      <p className="error">{bookingErrorText(error)}</p>
      <button type="button" className="btn btn--sm" onClick={() => void router.invalidate()}>
        Дахин оролдох
      </button>
    </section>
  )
}

type DayPreviewResult = { date: string; kind: 'loaded'; day: ScheduleDay | null } | { date: string; kind: 'failed' }

/**
 * What else is on that day, so the admin doesn't double-book by eye. The API
 * refuses an overlap anyway (TIME_TAKEN); this just saves the round trip.
 * Admins aren't held to the open windows, so windows are shown, not enforced.
 *
 * Fetched here rather than in a loader: it follows the date as it is typed
 * inside a dialog, not the URL.
 */
function DayPreview({ date, ignoreId }: { date: string; ignoreId?: string }) {
  const [result, setResult] = useState<DayPreviewResult | null>(null)
  const dateIsComplete = ISO_DATE.test(date)

  useEffect(() => {
    if (!dateIsComplete) return
    // An answer for a date the admin has since changed is dropped.
    let current = true
    adminBookingApi.schedule(date, date).then(
      (days) => {
        if (current) setResult({ date, kind: 'loaded', day: days[0] ?? null })
      },
      () => {
        if (current) setResult({ date, kind: 'failed' })
      },
    )
    return () => {
      current = false
    }
  }, [date, dateIsComplete])

  // Only an answer for the date on screen: never the last day under a new heading.
  if (result === null || result.date !== date) return null
  if (result.kind === 'failed') {
    return <p className="adm__muted bka-preview">Энэ өдрийн захиалгыг харуулж чадсангүй.</p>
  }
  if (result.day === null) return null
  return <DayPreviewList day={result.day} ignoreId={ignoreId} />
}

function DayPreviewList({ day, ignoreId }: { day: ScheduleDay; ignoreId?: string }) {
  const taken = day.appointments.filter((a) => a.id !== ignoreId)
  return (
    <div className="bka-preview">
      <p className="adm__statlabel">{dayTitle(day.date)}</p>
      <p className="adm__muted">
        Нээлттэй:{' '}
        {day.windows.length === 0 ? 'хуваарь нээгээгүй' : day.windows.map((w) => `${slotTime(w.startsAt)}–${slotTime(w.endsAt)}`).join(', ')}
      </p>
      {taken.length === 0 ? (
        <p className="adm__muted">Захиалга алга.</p>
      ) : (
        <ul className="bka-preview__list">
          {taken.map((a) => (
            <li key={a.id}>
              <b>
                {slotTime(a.startsAt)}–{slotTime(a.endsAt)}
              </b>{' '}
              {a.customerName} · {a.serviceName}
              {a.status === 'pending' && <span className="adm__muted"> (төлбөр хүлээж буй)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Dialog({ title, onClose, children, busy }: { title: string; onClose: () => void; children: React.ReactNode; busy: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__card bka-dialog">
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" aria-label="Хаах" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

interface BookingDraft {
  serviceId: string
  date: string
  time: string
  name: string
  phone: string
  email: string
  note: string
}

/**
 * A phone call or a walk-in: booked at once, no fee, any time — only an
 * overlap with another booking is refused. With an email, the confirmation
 * goes out.
 */
export function AddBookingDialog({
  services,
  defaultDate,
  onClose,
  onCreated,
}: {
  services: AdminService[]
  defaultDate: string
  onClose: () => void
  onCreated: (appointment: Appointment) => Promise<void>
}) {
  const active = services.filter((s) => s.isActive)
  const [draft, setDraft] = useState<BookingDraft>({
    serviceId: active[0]?.id ?? '',
    date: defaultDate,
    time: '',
    name: '',
    phone: '',
    email: '',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const service = active.find((s) => s.id === draft.serviceId)

  const change = (fields: Partial<BookingDraft>) => setDraft((current) => ({ ...current, ...fields }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const phoneDigits = draft.phone.replace(/\s/g, '')
    if (!PHONE_DIGITS.test(phoneDigits)) {
      setError('Утас 8 оронтой байна.')
      return
    }
    setBusy(true)
    try {
      const created = await adminBookingApi.createAppointment({
        serviceId: draft.serviceId,
        startsAt: ubInstant(draft.date, draft.time),
        customerName: draft.name.trim(),
        customerPhone: phoneDigits,
        customerEmail: draft.email.trim() || null,
        note: draft.note.trim() || null,
      })
      await onCreated(created)
    } catch (err) {
      setError(bookingErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Гараар захиалга нэмэх" onClose={onClose} busy={busy}>
      <form onInvalidCapture={localizeValidity} onInput={clearValidity} onSubmit={submit}>
        <div className="modal__body">
          {active.length === 0 ? (
            <p className="error">Идэвхтэй үйлчилгээ алга — эхлээд Үйлчилгээ хэсэгт нэмнэ үү.</p>
          ) : (
            <AddBookingFields services={active} draft={draft} onChange={change} />
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal__foot">
          <span className="adm__muted">
            {service && draft.time && ISO_DATE.test(draft.date)
              ? `${dayTitle(draft.date)} · ${draft.time} · ${formatDuration(service.durationMinutes)}`
              : 'Хуваарьт баригдахгүй — зөвхөн давхцал хориглоно.'}
          </span>
          <div className="adm__actions">
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={onClose}>
              Болих
            </button>
            <button type="submit" className="btn btn--sm" disabled={busy || active.length === 0}>
              {busy ? '…' : 'Захиалга нэмэх'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

function AddBookingFields({
  services,
  draft,
  onChange,
}: {
  services: AdminService[]
  draft: BookingDraft
  onChange: (fields: Partial<BookingDraft>) => void
}) {
  return (
    <>
      <div className="adm__cols">
        <label className="field">
          <span>Үйлчилгээ</span>
          <select value={draft.serviceId} onChange={(e) => onChange({ serviceId: e.target.value })} required>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatDuration(s.durationMinutes)}
              </option>
            ))}
          </select>
        </label>
        <div className="adm__cols bka-when">
          <label className="field">
            <span>Огноо</span>
            <input type="date" value={draft.date} min={todayUb()} required onChange={(e) => onChange({ date: e.target.value })} />
          </label>
          <label className="field">
            <span>Цаг</span>
            <input type="time" value={draft.time} step={300} required onChange={(e) => onChange({ time: e.target.value })} />
          </label>
        </div>
      </div>

      <DayPreview date={draft.date} />

      <div className="adm__cols">
        <label className="field">
          <span>Нэр</span>
          <input value={draft.name} required maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Утас</span>
          <input value={draft.phone} required inputMode="numeric" maxLength={9} onChange={(e) => onChange({ phone: e.target.value })} />
        </label>
      </div>
      <div className="adm__cols">
        <label className="field">
          <span>И-мэйл (заавал биш — байвал баталгаа очно)</span>
          <input type="email" value={draft.email} maxLength={255} onChange={(e) => onChange({ email: e.target.value })} />
        </label>
        <label className="field">
          <span>Тэмдэглэл (заавал биш)</span>
          <input value={draft.note} maxLength={500} onChange={(e) => onChange({ note: e.target.value })} placeholder="Утсаар захиалсан" />
        </label>
      </div>
    </>
  )
}

/** Any time; the length stays as booked. The customer is emailed the new time. */
export function RescheduleDialog({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment
  onClose: () => void
  onDone: (appointment: Appointment) => Promise<void>
}) {
  const currentDate = localDateOf(new Date(appointment.startsAt))
  const [date, setDate] = useState(currentDate)
  const [time, setTime] = useState(slotTime(appointment.startsAt))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const moved = await adminBookingApi.reschedule(appointment.id, ubInstant(date, time))
      await onDone(moved)
    } catch (err) {
      setError(bookingErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Цаг өөрчлөх · ${appointment.bookingNo}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal__body">
          <p className="adm__muted">
            Одоо: <b>{dayTitle(currentDate)}</b>{' '}
            {slotTime(appointment.startsAt)}–{slotTime(appointment.endsAt)} · {appointment.serviceName}
          </p>
          <div className="adm__cols">
            <label className="field">
              <span>Шинэ огноо</span>
              <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Шинэ цаг</span>
              <input type="time" value={time} step={300} required onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <DayPreview date={date} ignoreId={appointment.id} />
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal__foot">
          <span className="adm__muted">{appointment.customerEmail ? 'Үйлчлүүлэгчид и-мэйл очно.' : 'И-мэйлгүй — утсаар мэдэгдэнэ үү.'}</span>
          <div className="adm__actions">
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={onClose}>
              Болих
            </button>
            <button type="submit" className="btn btn--sm" disabled={busy}>
              {busy ? '…' : 'Цаг өөрчлөх'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
