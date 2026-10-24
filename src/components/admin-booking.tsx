import { useEffect, useState } from 'react'
import { BookingApiError } from '~/lib/booking/api'
import { adminBookingApi, ubInstant } from '~/lib/booking/admin-api'
import type { AdminService, Appointment, ScheduleDay } from '~/lib/booking/admin-api'
import { dayTitle, formatDuration, localDateOf, slotTime, todayUb } from '~/lib/booking/calendar'
import { clearValidity, localizeValidity } from '~/lib/form-messages'

/** Pieces the admin booking pages share: the add/reschedule dialogs and labels. */

export const APPOINTMENT_LABEL = { booked: 'Баталгаажсан', cancelled: 'Цуцалсан', pending: 'Төлбөр хүлээж буй' } as const
const APPOINTMENT_TONE = { booked: 'done', cancelled: 'dead', pending: 'wait' } as const

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
    if (err.code === 'TIME_TAKEN') return 'Энэ цаг өөр захиалгатай давхцаж байна.'
    if (err.code === 'NOT_BOOKED') return 'Зөвхөн баталгаажсан захиалгад үйлдэл хийнэ.'
    if (err.status === 404) return 'Олдсонгүй (идэвхгүй үйлчилгээ байж магадгүй).'
    if (err.code === 'VALIDATION') return 'Мэдээлэл буруу байна — талбаруудаа шалгана уу.'
    return err.message
  }
  return 'Алдаа гарлаа. Дахин оролдоно уу.'
}

/**
 * What else is on that day, so the admin doesn't double-book by eye. The API
 * refuses an overlap anyway (TIME_TAKEN); this just saves the round trip.
 * Admins aren't held to the open windows, so windows are shown, not enforced.
 */
function DayPreview({ date, ignoreId }: { date: string; ignoreId?: string }) {
  const [day, setDay] = useState<ScheduleDay | null>(null)
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    let live = true
    setDay(null)
    adminBookingApi
      .schedule(date, date)
      .then((days) => live && setDay(days[0] ?? null))
      .catch(() => live && setDay(null))
    return () => {
      live = false
    }
  }, [date])

  if (!day) return null
  const busy = day.appointments.filter((a) => a.id !== ignoreId)
  return (
    <div className="bka-preview">
      <p className="adm__statlabel">{dayTitle(date)}</p>
      <p className="adm__muted">
        Нээлттэй:{' '}
        {day.windows.length === 0 ? 'хуваарь нээгээгүй' : day.windows.map((w) => `${slotTime(w.startsAt)}–${slotTime(w.endsAt)}`).join(', ')}
      </p>
      {busy.length === 0 ? (
        <p className="adm__muted">Захиалга алга.</p>
      ) : (
        <ul className="bka-preview__list">
          {busy.map((a) => (
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
  onCreated: (appointment: Appointment) => void
}) {
  const active = services.filter((s) => s.isActive)
  const [serviceId, setServiceId] = useState(active[0]?.id ?? '')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const service = active.find((s) => s.id === serviceId)

  return (
    <Dialog title="Гараар захиалга нэмэх" onClose={onClose} busy={busy}>
      <form
        onInvalidCapture={localizeValidity}
        onInput={clearValidity}
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          const digits = phone.replace(/\s/g, '')
          if (!/^\d{8}$/.test(digits)) return setError('Утас 8 оронтой байна.')
          setBusy(true)
          try {
            const created = await adminBookingApi.createAppointment({
              serviceId,
              startsAt: ubInstant(date, time),
              customerName: name.trim(),
              customerPhone: digits,
              customerEmail: email.trim() || null,
              note: note.trim() || null,
            })
            onCreated(created)
          } catch (err) {
            setError(bookingErrorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="modal__body">
          {active.length === 0 ? (
            <p className="error">Идэвхтэй үйлчилгээ алга — эхлээд Үйлчилгээ хэсэгт нэмнэ үү.</p>
          ) : (
            <>
              <div className="adm__cols">
                <label className="field">
                  <span>Үйлчилгээ</span>
                  <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                    {active.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {formatDuration(s.durationMinutes)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="adm__cols bka-when">
                  <label className="field">
                    <span>Огноо</span>
                    <input type="date" value={date} min={todayUb()} required onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Цаг</span>
                    <input type="time" value={time} step={300} required onChange={(e) => setTime(e.target.value)} />
                  </label>
                </div>
              </div>

              <DayPreview date={date} />

              <div className="adm__cols">
                <label className="field">
                  <span>Нэр</span>
                  <input value={name} required maxLength={120} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">
                  <span>Утас</span>
                  <input value={phone} required inputMode="numeric" maxLength={9} onChange={(e) => setPhone(e.target.value)} />
                </label>
              </div>
              <div className="adm__cols">
                <label className="field">
                  <span>И-мэйл (заавал биш — байвал баталгаа очно)</span>
                  <input type="email" value={email} maxLength={255} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className="field">
                  <span>Тэмдэглэл (заавал биш)</span>
                  <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Утсаар захиалсан" />
                </label>
              </div>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal__foot">
          <span className="adm__muted">
            {service && time ? `${dayTitle(date)} · ${time} · ${formatDuration(service.durationMinutes)}` : 'Хуваарьт баригдахгүй — зөвхөн давхцал хориглоно.'}
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

/** Any time; the length stays as booked. The customer is emailed the new time. */
export function RescheduleDialog({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment
  onClose: () => void
  onDone: (appointment: Appointment) => void
}) {
  const currentDate = localDateOf(new Date(appointment.startsAt))
  const [date, setDate] = useState(currentDate)
  const [time, setTime] = useState(slotTime(appointment.startsAt))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog title={`Цаг өөрчлөх · ${appointment.bookingNo}`} onClose={onClose} busy={busy}>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          setBusy(true)
          try {
            onDone(await adminBookingApi.reschedule(appointment.id, ubInstant(date, time)))
          } catch (err) {
            setError(bookingErrorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
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
