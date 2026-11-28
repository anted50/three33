import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { AddBookingDialog, AppointmentBadge, BookingLoadFailed, RescheduleDialog, SourceBadge, bookingErrorText } from '~/components/admin-booking'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { assertNever } from '~/lib/assert'
import { adminBookingApi } from '~/lib/booking/admin-api'
import type { Appointment, AppointmentStatus } from '~/lib/booking/admin-api'
import { addDays, dayTitle, formatDuration, localDateOf, slotTime, todayUb } from '~/lib/booking/calendar'
import { dayCount } from '~/lib/server/booking/time'
import { formatDateTime } from '~/lib/dates'
import { formatMnt } from '~/lib/money'

/**
 * Every booking, day by day: who, when, what, and whether the fee came in.
 * Picking a row opens it on the right with what an admin can do to a booking —
 * move it, cancel it, resend the confirmation. "Гараар нэмэх" enters a phone
 * call or a walk-in.
 */

type Show = 'booked' | 'cancelled' | 'pending' | 'all'

const searchSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  /** booked (default) · cancelled · pending (unpaid holds) · all = booked + cancelled */
  show: z.enum(['booked', 'cancelled', 'pending', 'all']).optional().catch(undefined),
  id: z.uuid().optional().catch(undefined),
})

/**
 * Most days the list asks for at once: the API's limit (MAX_SCHEDULE_DAYS in
 * schedule-plan.ts, which imports server-only code, so it is repeated here).
 */
const RANGE_DAYS_MAX = 93

/** The default view: today and the next six days. */
const defaultRange = () => ({ from: todayUb(), to: addDays(todayUb(), 6) })

/**
 * The range a URL asks for, made one the API accepts: a `to` before `from`
 * shows just `from`, and a range past the limit is cut short at the end,
 * instead of the page failing on a hand-typed date.
 */
function bookingsRange(search: { from?: string; to?: string }): { from: string; to: string } {
  const from = search.from ?? defaultRange().from
  const to = search.to ?? defaultRange().to
  if (to < from) return { from, to: from }
  if (dayCount(from, to) > RANGE_DAYS_MAX) return { from, to: addDays(from, RANGE_DAYS_MAX - 1) }
  return { from, to }
}

export const Route = createFileRoute('/admin/bookings')({
  // Reads /api/v1/admin from the browser, with the admin's session cookie.
  ssr: false,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to, show: search.show }),
  loader: async ({ deps }) => {
    const { from, to } = bookingsRange(deps)
    const show: Show = deps.show ?? 'booked'
    const status: AppointmentStatus | undefined = show === 'all' ? undefined : show
    const [appointments, services, fee] = await Promise.all([
      adminBookingApi.appointments(from, to, status),
      adminBookingApi.services(),
      adminBookingApi.bookingFee(),
    ])
    return { appointments, services, bookingFee: fee.bookingFee, from, to, show }
  },
  errorComponent: BookingLoadFailed,
  component: Bookings,
})

const SHOW_OPTIONS: Array<{ key: Show; label: string }> = [
  { key: 'booked', label: 'Баталгаажсан' },
  { key: 'pending', label: 'Төлбөр хүлээж буй' },
  { key: 'cancelled', label: 'Цуцалсан' },
  { key: 'all', label: 'Бүгд' },
]

type DateRange = { from: string; to: string }

/**
 * The shown range stretched to take in `day`, so a booking just added is on
 * screen. When stretching would pass the API's limit, just that day.
 */
function rangeIncluding(range: DateRange, day: string): DateRange {
  const from = day < range.from ? day : range.from
  const to = day > range.to ? day : range.to
  if (dayCount(from, to) > RANGE_DAYS_MAX) return { from: day, to: day }
  return { from, to }
}

function Bookings() {
  const { appointments, services, bookingFee, from, to, show } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [adding, setAdding] = useState(false)

  const selected = appointments.find((a) => a.id === search.id) ?? null

  const setRange = (range: DateRange) => navigate({ search: (prev) => ({ ...prev, ...range, id: undefined }) })
  const setShow = (key: Show) => navigate({ search: (prev) => ({ ...prev, show: key === 'booked' ? undefined : key, id: undefined }) })
  const select = (id: string | undefined) => navigate({ search: (prev) => ({ ...prev, id }), replace: true })

  async function showCreated(created: Appointment) {
    setAdding(false)
    const day = localDateOf(new Date(created.startsAt))
    // Show the new booking even if it falls outside the current range.
    const range = rangeIncluding({ from, to }, day)
    await navigate({ search: (prev) => ({ ...prev, ...range, show: undefined, id: created.id }) })
    await router.invalidate()
  }

  return (
    <>
      <BookingsHeader bookingFee={bookingFee} onAdd={() => setAdding(true)} />
      <BookingStats appointments={appointments} from={from} to={to} />
      <BookingsToolbar from={from} to={to} show={show} onRange={setRange} onShow={setShow} />

      <div className="bka-split">
        <section className="adm__card">
          {appointments.length === 0 ? (
            <p className="adm__muted adm__pad">Энэ хугацаанд захиалга алга.</p>
          ) : (
            <AppointmentTable appointments={appointments} selectedId={selected?.id} onSelect={select} />
          )}
        </section>

        {selected ? (
          <BookingDetail key={selected.id} appointment={selected} onClose={() => select(undefined)} />
        ) : (
          <section className="adm__card adm__pad bka-side bka-side--empty">
            <p className="adm__muted">Захиалга сонгоход дэлгэрэнгүй энд гарна.</p>
          </section>
        )}
      </div>

      {adding && <AddBookingDialog services={services} defaultDate={todayUb()} onClose={() => setAdding(false)} onCreated={showCreated} />}
    </>
  )
}

function BookingsHeader({ bookingFee, onAdd }: { bookingFee: number | null; onAdd: () => void }) {
  return (
    <header className="adm__head">
      <div>
        <h1>Цаг захиалга</h1>
        <p className="adm__muted">
          {bookingFee === null ? (
            <>
              Онлайн захиалга хаалттай — <Link to="/admin/services">захиалгын төлбөр тохируулна уу</Link>.
            </>
          ) : (
            `Онлайн захиалга нээлттэй · урьдчилгаа ${formatMnt(bookingFee)}`
          )}
        </p>
      </div>
      <div className="adm__headactions">
        <Link to="/admin/schedule" className="btn btn--sm btn--ghost">
          Хуваарь
        </Link>
        <button type="button" className="btn btn--sm" onClick={onAdd}>
          + Гараар нэмэх
        </button>
      </div>
    </header>
  )
}

/** "10.29" */
const monthAndDay = (date: string) => date.slice(5).replace('-', '.')

function BookingStats({ appointments, from, to }: { appointments: Appointment[]; from: string; to: string }) {
  const booked = appointments.filter((a) => a.status === 'booked')
  const now = Date.now()
  const next = booked.find((a) => new Date(a.startsAt).getTime() > now)
  const feesPaid = appointments.filter((a) => a.source === 'online' && a.paidAt).reduce((sum, a) => sum + a.bookingFee, 0)

  return (
    <div className="adm__stats">
      <section className="adm__card adm__stat">
        <p className="adm__statlabel">Баталгаажсан</p>
        <p className="adm__statvalue">{booked.length}</p>
        <p className="adm__muted">{from === to ? dayTitle(from) : `${monthAndDay(from)} — ${monthAndDay(to)}`}</p>
      </section>
      <section className="adm__card adm__stat">
        <p className="adm__statlabel">Дараагийн захиалга</p>
        <p className="adm__statvalue">{next ? slotTime(next.startsAt) : '—'}</p>
        <p className="adm__muted">{next ? `${dayTitle(localDateOf(new Date(next.startsAt)))} · ${next.customerName}` : 'Энэ хугацаанд алга'}</p>
      </section>
      <section className="adm__card adm__stat">
        <p className="adm__statlabel">Орсон урьдчилгаа</p>
        <p className="adm__statvalue">{formatMnt(feesPaid)}</p>
        <p className="adm__muted">Харуулж буй онлайн захиалгаас</p>
      </section>
    </div>
  )
}

function BookingsToolbar({
  from,
  to,
  show,
  onRange,
  onShow,
}: {
  from: string
  to: string
  show: Show
  onRange: (range: DateRange) => void
  onShow: (show: Show) => void
}) {
  const today = todayUb()
  return (
    <div className="adm__toolbar">
      <div className="adm__daterange">
        <div className="bka-seg" role="group" aria-label="Хугацаа">
          <button type="button" data-active={from === today && to === today} onClick={() => onRange({ from: today, to: today })}>
            Өнөөдөр
          </button>
          <button type="button" data-active={from === today && to === addDays(today, 6)} onClick={() => onRange(defaultRange())}>
            7 хоног
          </button>
          <button type="button" data-active={from === today && to === addDays(today, 29)} onClick={() => onRange({ from: today, to: addDays(today, 29) })}>
            30 хоног
          </button>
        </div>
        <label className="field">
          <span>Эхлэх огноо</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && onRange({ from: e.target.value, to })} />
        </label>
        <label className="field">
          <span>Дуусах огноо</span>
          <input
            type="date"
            value={to}
            min={from}
            max={addDays(from, RANGE_DAYS_MAX - 1)}
            onChange={(e) => e.target.value && onRange({ from, to: e.target.value })}
          />
        </label>
      </div>
      <div className="bka-seg" role="group" aria-label="Төлөв">
        {SHOW_OPTIONS.map((option) => (
          <button key={option.key} type="button" data-active={show === option.key} onClick={() => onShow(option.key)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Grouped by Ulaanbaatar day, in order (the API returns them earliest first). */
function groupByDay(appointments: Appointment[]): Map<string, Appointment[]> {
  const byDay = new Map<string, Appointment[]>()
  for (const appointment of appointments) {
    const day = localDateOf(new Date(appointment.startsAt))
    const rows = byDay.get(day)
    if (rows) rows.push(appointment)
    else byDay.set(day, [appointment])
  }
  return byDay
}

function AppointmentTable({
  appointments,
  selectedId,
  onSelect,
}: {
  appointments: Appointment[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  const today = todayUb()
  return (
    <table className="adm__table bka-list">
      <thead>
        <tr>
          <th>Цаг</th>
          <th>Үйлчлүүлэгч</th>
          <th>Үйлчилгээ</th>
          <th>Эх сурвалж</th>
          <th>Төлөв</th>
        </tr>
      </thead>
      {[...groupByDay(appointments)].map(([day, rows]) => (
        <tbody key={day}>
          <tr className="bka-dayrow">
            <th colSpan={5}>
              {dayTitle(day)}
              {day === today && ' · Өнөөдөр'}
              <span>{rows.length} захиалга</span>
            </th>
          </tr>
          {rows.map((a) => (
            <AppointmentRow key={a.id} appointment={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
          ))}
        </tbody>
      ))}
    </table>
  )
}

function AppointmentRow({ appointment: a, selected, onSelect }: { appointment: Appointment; selected: boolean; onSelect: () => void }) {
  return (
    <tr className="bka-row" data-selected={selected} data-status={a.status} onClick={onSelect}>
      <td className="adm__num">
        <b>{slotTime(a.startsAt)}</b>
        <span className="adm__muted"> – {slotTime(a.endsAt)}</span>
      </td>
      <td>
        {/* A real link too, so keyboard users can open a row. */}
        <Link to="/admin/bookings" search={(prev) => ({ ...prev, id: a.id })} replace className="bka-row__name">
          {a.customerName}
        </Link>
        <div className="adm__muted adm__num">{a.customerPhone}</div>
      </td>
      <td>
        {a.serviceName}
        <div className="adm__muted">{formatDuration(a.durationMinutes)}</div>
      </td>
      <td>
        <SourceBadge source={a.source} />
      </td>
      <td>
        <AppointmentBadge status={a.status} />
      </td>
    </tr>
  )
}

type Message = { kind: 'ok' | 'error'; text: string }

function resendMessage(outcome: 'sent' | 'mail_disabled' | 'no_email', email: string | null): Message {
  if (outcome === 'sent') return { kind: 'ok', text: `Баталгааг ${email} руу дахин илгээлээ.` }
  if (outcome === 'no_email') return { kind: 'error', text: 'Энэ захиалгад и-мэйл алга.' }
  if (outcome === 'mail_disabled') return { kind: 'error', text: 'И-мэйл илгээх тохиргоогүй байна (RESEND_API_KEY).' }
  return assertNever(outcome, 'resendMessage: unknown outcome')
}

function BookingDetail({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  async function resend() {
    setBusy(true)
    setMessage(null)
    try {
      const { outcome } = await adminBookingApi.resendConfirmation(a.id)
      setMessage(resendMessage(outcome, a.customerEmail))
    } catch (err) {
      setMessage({ kind: 'error', text: bookingErrorText(err) })
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    setMessage(null)
    try {
      await adminBookingApi.cancel(a.id)
      setDialog(null)
      // Stay on it: "Бүгд" still lists it, now marked cancelled, instead of
      // it vanishing from the default (confirmed-only) view.
      await navigate({ search: (prev) => ({ ...prev, show: prev.show === 'cancelled' ? 'cancelled' : 'all' }), replace: true })
      await router.invalidate()
    } catch (err) {
      setDialog(null)
      setMessage({ kind: 'error', text: bookingErrorText(err) })
    } finally {
      setBusy(false)
    }
  }

  async function rescheduled() {
    setDialog(null)
    // The API sends the email in the background and doesn't report back, so promise no more than that.
    setMessage({ kind: 'ok', text: a.customerEmail ? 'Цагийг өөрчиллөө — үйлчлүүлэгчид и-мэйлээр мэдэгдэнэ.' : 'Цагийг өөрчиллөө. И-мэйлгүй тул утсаар мэдэгдэнэ үү.' })
    await router.invalidate()
  }

  return (
    <section className="adm__card bka-side">
      <BookingDetailHead appointment={a} onClose={onClose} />
      <BookingWhen appointment={a} />
      <BookingFacts appointment={a} />

      {message && <p className={message.kind === 'ok' ? 'bka-ok' : 'error'}>{message.text}</p>}

      <BookingActions appointment={a} busy={busy} onReschedule={() => setDialog('reschedule')} onResend={resend} onCancel={() => setDialog('cancel')} />

      {dialog === 'reschedule' && <RescheduleDialog appointment={a} onClose={() => setDialog(null)} onDone={rescheduled} />}
      {dialog === 'cancel' && (
        <ConfirmDialog
          title="Захиалга цуцлах уу?"
          message={cancelWarning(a)}
          confirmLabel="Цуцлах"
          cancelLabel="Үгүй"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={cancel}
        />
      )}
    </section>
  )
}

function BookingDetailHead({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  return (
    <div className="adm__cardhead">
      <div>
        <p className="adm__statlabel">{a.bookingNo}</p>
        <h2 className="bka-side__name">{a.customerName}</h2>
      </div>
      <div className="adm__rowactions">
        <AppointmentBadge status={a.status} />
        <button type="button" className="adm__iconbtn adm__iconbtn--neutral" aria-label="Хаах" title="Хаах" onClick={onClose}>
          ×
        </button>
      </div>
    </div>
  )
}

function cancelWarning(a: Appointment): string {
  const date = localDateOf(new Date(a.startsAt))
  const emailNote = a.customerEmail ? 'Үйлчлүүлэгчид и-мэйл очно. ' : ''
  const feeNote = a.source === 'online' ? `${formatMnt(a.bookingFee)} урьдчилгаа буцаагдахгүй.` : ''
  return `${a.customerName} · ${dayTitle(date)} ${slotTime(a.startsAt)}. ${emailNote}${feeNote}`
}

function BookingWhen({ appointment: a }: { appointment: Appointment }) {
  const date = localDateOf(new Date(a.startsAt))
  return (
    <div className="bka-when-block">
      <span className="bka-datetile">
        <small>{Number(date.slice(5, 7))}-р сар</small>
        <b>{Number(date.slice(8, 10))}</b>
      </span>
      <div>
        <div className="bka-when-block__time">
          {slotTime(a.startsAt)} — {slotTime(a.endsAt)}
        </div>
        <div className="adm__muted">
          {dayTitle(date)} · {a.serviceName} · {formatDuration(a.durationMinutes)}
        </div>
      </div>
    </div>
  )
}

function feeText(a: Appointment): string {
  if (a.source === 'admin') return 'Байхгүй'
  if (a.paidAt) return `${formatMnt(a.bookingFee)} · ${formatDateTime(a.paidAt)}`
  return `${formatMnt(a.bookingFee)} — төлөгдөөгүй`
}

function BookingFacts({ appointment: a }: { appointment: Appointment }) {
  return (
    <dl className="bka-kv">
      <dt>Утас</dt>
      <dd>
        <a href={`tel:+976${a.customerPhone}`} className="adm__num">
          {a.customerPhone}
        </a>
      </dd>
      <dt>И-мэйл</dt>
      <dd>{a.customerEmail ?? '—'}</dd>
      <dt>Эх сурвалж</dt>
      <dd>{a.source === 'online' ? 'Онлайн' : 'Гараар оруулсан'}</dd>
      <dt>Урьдчилгаа</dt>
      <dd>{feeText(a)}</dd>
      {a.status === 'pending' && a.expiresAt && (
        <>
          <dt>Хадгалах хугацаа</dt>
          <dd>{formatDateTime(a.expiresAt)} хүртэл</dd>
        </>
      )}
      {a.cancelledAt && (
        <>
          <dt>Цуцалсан</dt>
          <dd>{formatDateTime(a.cancelledAt)}</dd>
        </>
      )}
      {a.note && (
        <>
          <dt>Тэмдэглэл</dt>
          <dd>{a.note}</dd>
        </>
      )}
    </dl>
  )
}

/** Only a confirmed booking can be moved, resent or cancelled; an unpaid hold resolves itself. */
function BookingActions({
  appointment: a,
  busy,
  onReschedule,
  onResend,
  onCancel,
}: {
  appointment: Appointment
  busy: boolean
  onReschedule: () => void
  onResend: () => void
  onCancel: () => void
}) {
  if (a.status === 'pending') {
    return <p className="adm__muted adm__pad bka-note">Төлбөр орвол автоматаар баталгаажна; орохгүй бол хугацаа дуусахад устна.</p>
  }
  if (a.status === 'cancelled') return null
  return (
    <div className="bka-side__actions">
      <button type="button" className="btn" disabled={busy} onClick={onReschedule}>
        Цаг өөрчлөх
      </button>
      <button type="button" className="btn btn--ghost" disabled={busy || !a.customerEmail} onClick={onResend}>
        {busy ? '…' : 'Баталгаа дахин илгээх'}
      </button>
      <button type="button" className="btn btn--ghost bka-danger" disabled={busy} onClick={onCancel}>
        Цуцлах
      </button>
      <p className="adm__muted bka-note">Цуцалбал цаг чөлөөлөгдөж, үйлчлүүлэгчид и-мэйл очно. Онлайн урьдчилгаа буцаагдахгүй.</p>
    </div>
  )
}
