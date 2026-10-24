import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { AddBookingDialog, AppointmentBadge, RescheduleDialog, SourceBadge, bookingErrorText } from '~/components/admin-booking'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { adminBookingApi } from '~/lib/booking/admin-api'
import type { Appointment, AppointmentStatus } from '~/lib/booking/admin-api'
import { addDays, dayTitle, formatDuration, localDateOf, slotTime, todayUb } from '~/lib/booking/calendar'
import { formatDateTime } from '~/lib/dates'
import { formatMnt } from '~/lib/money'

/**
 * Every booking, day by day: who, when, what, and whether the fee came in.
 * Picking a row opens it on the right with what an admin can do to a booking —
 * move it, cancel it, resend the confirmation. "Гараар нэмэх" enters a phone
 * call or a walk-in.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const searchSchema = z.object({
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  /** booked (default) · cancelled · pending (unpaid holds) · all = booked + cancelled */
  show: z.enum(['booked', 'cancelled', 'pending', 'all']).optional().catch(undefined),
  id: z.uuid().optional().catch(undefined),
})

/** The default view: today and the next six days. */
const defaultRange = () => ({ from: todayUb(), to: addDays(todayUb(), 6) })

export const Route = createFileRoute('/admin/bookings')({
  // Reads /api/v1/admin from the browser, with the admin's session cookie.
  ssr: false,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to, show: search.show }),
  loader: async ({ deps }) => {
    const { from, to } = { ...defaultRange(), ...(deps.from && { from: deps.from }), ...(deps.to && { to: deps.to }) }
    const show = deps.show ?? 'booked'
    const status: AppointmentStatus | undefined = show === 'all' ? undefined : show
    const [appointments, services, fee] = await Promise.all([
      adminBookingApi.appointments(from, to, status),
      adminBookingApi.services(),
      adminBookingApi.bookingFee(),
    ])
    return { appointments, services, bookingFee: fee.bookingFee, from, to, show }
  },
  component: Bookings,
})

const SHOW: Array<{ key: 'booked' | 'cancelled' | 'pending' | 'all'; label: string }> = [
  { key: 'booked', label: 'Баталгаажсан' },
  { key: 'pending', label: 'Төлбөр хүлээж буй' },
  { key: 'cancelled', label: 'Цуцалсан' },
  { key: 'all', label: 'Бүгд' },
]

function Bookings() {
  const { appointments, services, bookingFee, from, to, show } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [adding, setAdding] = useState(false)

  const selected = appointments.find((a) => a.id === search.id) ?? null
  const today = todayUb()

  // Grouped by Ulaanbaatar day, in order (the API returns them earliest first).
  const byDay = new Map<string, Appointment[]>()
  for (const a of appointments) {
    const day = localDateOf(new Date(a.startsAt))
    byDay.set(day, [...(byDay.get(day) ?? []), a])
  }

  const booked = appointments.filter((a) => a.status === 'booked')
  const now = Date.now()
  const next = booked.find((a) => new Date(a.startsAt).getTime() > now)
  const feesIn = appointments.filter((a) => a.source === 'online' && a.paidAt).reduce((sum, a) => sum + a.bookingFee, 0)

  const setRange = (range: { from: string; to: string }) => navigate({ search: (prev) => ({ ...prev, ...range, id: undefined }) })

  return (
    <>
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
          <button type="button" className="btn btn--sm" onClick={() => setAdding(true)}>
            + Гараар нэмэх
          </button>
        </div>
      </header>

      <div className="adm__stats">
        <section className="adm__card adm__stat">
          <p className="adm__statlabel">Баталгаажсан</p>
          <p className="adm__statvalue">{booked.length}</p>
          <p className="adm__muted">
            {from === to ? dayTitle(from) : `${from.slice(5).replace('-', '.')} — ${to.slice(5).replace('-', '.')}`}
          </p>
        </section>
        <section className="adm__card adm__stat">
          <p className="adm__statlabel">Дараагийн захиалга</p>
          <p className="adm__statvalue">{next ? slotTime(next.startsAt) : '—'}</p>
          <p className="adm__muted">{next ? `${dayTitle(localDateOf(new Date(next.startsAt)))} · ${next.customerName}` : 'Энэ хугацаанд алга'}</p>
        </section>
        <section className="adm__card adm__stat">
          <p className="adm__statlabel">Орсон урьдчилгаа</p>
          <p className="adm__statvalue">{formatMnt(feesIn)}</p>
          <p className="adm__muted">Харуулж буй онлайн захиалгаас</p>
        </section>
      </div>

      <div className="adm__toolbar">
        <div className="adm__daterange">
          <div className="bka-seg" role="group" aria-label="Хугацаа">
            <button type="button" data-active={from === today && to === today} onClick={() => setRange({ from: today, to: today })}>
              Өнөөдөр
            </button>
            <button type="button" data-active={from === today && to === addDays(today, 6)} onClick={() => setRange(defaultRange())}>
              7 хоног
            </button>
            <button type="button" data-active={from === today && to === addDays(today, 29)} onClick={() => setRange({ from: today, to: addDays(today, 29) })}>
              30 хоног
            </button>
          </div>
          <label className="field">
            <span>Эхлэх огноо</span>
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setRange({ from: e.target.value, to })} />
          </label>
          <label className="field">
            <span>Дуусах огноо</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setRange({ from, to: e.target.value })} />
          </label>
        </div>
        <div className="bka-seg" role="group" aria-label="Төлөв">
          {SHOW.map((s) => (
            <button
              key={s.key}
              type="button"
              data-active={show === s.key}
              onClick={() => navigate({ search: (prev) => ({ ...prev, show: s.key === 'booked' ? undefined : s.key, id: undefined }) })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bka-split">
        <section className="adm__card">
          {appointments.length === 0 ? (
            <p className="adm__muted adm__pad">Энэ хугацаанд захиалга алга.</p>
          ) : (
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
              {[...byDay].map(([day, rows]) => (
                <tbody key={day}>
                  <tr className="bka-dayrow">
                    <th colSpan={5}>
                      {dayTitle(day)}
                      {day === today && ' · Өнөөдөр'}
                      <span>{rows.length} захиалга</span>
                    </th>
                  </tr>
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      className="bka-row"
                      data-selected={a.id === selected?.id}
                      data-status={a.status}
                      onClick={() => navigate({ search: (prev) => ({ ...prev, id: a.id }), replace: true })}
                    >
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
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </section>

        {selected ? (
          <BookingDetail
            key={selected.id}
            appointment={selected}
            onClose={() => navigate({ search: (prev) => ({ ...prev, id: undefined }), replace: true })}
          />
        ) : (
          <section className="adm__card adm__pad bka-side bka-side--empty">
            <p className="adm__muted">Захиалга сонгоход дэлгэрэнгүй энд гарна.</p>
          </section>
        )}
      </div>

      {adding && (
        <AddBookingDialog
          services={services}
          defaultDate={today}
          onClose={() => setAdding(false)}
          onCreated={async (created) => {
            setAdding(false)
            const day = localDateOf(new Date(created.startsAt))
            // Show the new booking even if it falls outside the current range.
            await navigate({
              search: (prev) => ({
                ...prev,
                show: undefined,
                from: day < from ? day : prev.from,
                to: day > to ? day : prev.to,
                id: created.id,
              }),
            })
            await router.invalidate()
          }}
        />
      )}
    </>
  )
}

function BookingDetail({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function resend() {
    setBusy(true)
    setMessage(null)
    try {
      const { outcome } = await adminBookingApi.resendConfirmation(a.id)
      setMessage(
        outcome === 'sent'
          ? { kind: 'ok', text: `Баталгааг ${a.customerEmail} руу дахин илгээлээ.` }
          : outcome === 'no_email'
            ? { kind: 'error', text: 'Энэ захиалгад и-мэйл алга.' }
            : { kind: 'error', text: 'И-мэйл илгээх тохиргоогүй байна (RESEND_API_KEY).' },
      )
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

  const date = localDateOf(new Date(a.startsAt))

  return (
    <section className="adm__card bka-side">
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
        <dd>
          {a.source === 'admin'
            ? 'Байхгүй'
            : a.paidAt
              ? `${formatMnt(a.bookingFee)} · ${formatDateTime(a.paidAt)}`
              : `${formatMnt(a.bookingFee)} — төлөгдөөгүй`}
        </dd>
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

      {message && <p className={message.kind === 'ok' ? 'bka-ok' : 'error'}>{message.text}</p>}

      {a.status === 'booked' ? (
        <div className="bka-side__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => setDialog('reschedule')}>
            Цаг өөрчлөх
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy || !a.customerEmail} onClick={resend}>
            {busy ? '…' : 'Баталгаа дахин илгээх'}
          </button>
          <button type="button" className="btn btn--ghost bka-danger" disabled={busy} onClick={() => setDialog('cancel')}>
            Цуцлах
          </button>
          <p className="adm__muted bka-note">Цуцалбал цаг чөлөөлөгдөж, үйлчлүүлэгчид и-мэйл очно. Онлайн урьдчилгаа буцаагдахгүй.</p>
        </div>
      ) : a.status === 'pending' ? (
        <p className="adm__muted adm__pad bka-note">Төлбөр орвол автоматаар баталгаажна; орохгүй бол хугацаа дуусахад устна.</p>
      ) : null}

      {dialog === 'reschedule' && (
        <RescheduleDialog
          appointment={a}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            // The API sends the email in the background and doesn't report back, so promise no more than that.
            setMessage({ kind: 'ok', text: a.customerEmail ? 'Цагийг өөрчиллөө — үйлчлүүлэгчид и-мэйлээр мэдэгдэнэ.' : 'Цагийг өөрчиллөө. И-мэйлгүй тул утсаар мэдэгдэнэ үү.' })
            await router.invalidate()
          }}
        />
      )}
      {dialog === 'cancel' && (
        <ConfirmDialog
          title="Захиалга цуцлах уу?"
          message={`${a.customerName} · ${dayTitle(date)} ${slotTime(a.startsAt)}. ${a.customerEmail ? 'Үйлчлүүлэгчид и-мэйл очно. ' : ''}${
            a.source === 'online' ? `${formatMnt(a.bookingFee)} урьдчилгаа буцаагдахгүй.` : ''
          }`}
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
