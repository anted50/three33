import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { ChevronLeftIcon, ChevronRightIcon } from '~/components/admin-icons'
import { bookingErrorText } from '~/components/admin-booking'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { adminBookingApi } from '~/lib/booking/admin-api'
import type { ScheduleDay, ScheduleEntry } from '~/lib/booking/admin-api'
import { addDays, dayOfMonth, isoWeekday, slotTime, todayUb, weekdayShort } from '~/lib/booking/calendar'

/**
 * The barber's week: the windows he opened for online booking, and the
 * bookings in them. Opening and closing days is the form on the right — a
 * date range, which weekdays, and the hours (several per day are fine:
 * morning and evening). A change replaces each touched day whole; bookings
 * are never touched by it.
 */

const searchSchema = z.object({
  /** Any date in the week to show; the grid starts on its Monday. */
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
})

const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(date))

export const Route = createFileRoute('/admin/schedule')({
  // Reads /api/v1/admin from the browser, with the admin's session cookie.
  ssr: false,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: async ({ deps }) => {
    const monday = mondayOf(deps.week ?? todayUb())
    return { monday, days: await adminBookingApi.schedule(monday, addDays(monday, 6)) }
  },
  component: Schedule,
})

const HOUR_PX = 48
const WEEKDAYS = ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня']

/** Hours of the day as a decimal in Ulaanbaatar time: 14:30 → 14.5 */
const hourOf = (instant: string) => {
  const [h, m] = slotTime(instant).split(':').map(Number)
  return (h ?? 0) + (m ?? 0) / 60
}

function Schedule() {
  const { monday, days } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [closing, setClosing] = useState<{ id: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = todayUb()

  // The grid spans the week's earliest start to latest end, at least 09–21.
  const all = days.flatMap((d) => [...d.windows, ...d.appointments])
  const startHour = Math.min(9, ...all.map((x) => Math.floor(hourOf(x.startsAt))))
  const endHour = Math.max(21, ...all.map((x) => Math.ceil(hourOf(x.endsAt) || 24)))
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)

  async function closeWindow(id: string) {
    setBusy(true)
    setError(null)
    try {
      await adminBookingApi.deleteWindow(id)
      setClosing(null)
      await router.invalidate()
    } catch (err) {
      setClosing(null)
      setError(bookingErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Хуваарь</h1>
          <p className="adm__muted">
            {monday.replaceAll('-', '.')} — {addDays(monday, 6).slice(5).replace('-', '.')}
          </p>
        </div>
        <div className="adm__headactions">
          <button
            type="button"
            className="adm__iconbtn adm__iconbtn--neutral"
            aria-label="Өмнөх 7 хоног"
            title="Өмнөх 7 хоног"
            onClick={() => navigate({ search: { week: addDays(monday, -7) } })}
          >
            <ChevronLeftIcon />
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => navigate({ search: {} })}>
            Энэ 7 хоног
          </button>
          <button
            type="button"
            className="adm__iconbtn adm__iconbtn--neutral"
            aria-label="Дараах 7 хоног"
            title="Дараах 7 хоног"
            onClick={() => navigate({ search: { week: addDays(monday, 7) } })}
          >
            <ChevronRightIcon />
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="bka-split bka-split--schedule">
        <section className="adm__card">
          <div className="adm__cardhead">
            <div className="bka-legend">
              <span>
                <i data-kind="window" />
                Нээлттэй цонх
              </span>
              <span>
                <i data-kind="online" />
                Онлайн
              </span>
              <span>
                <i data-kind="pending" />
                Төлбөр хүлээж буй
              </span>
            </div>
            <span className="adm__muted bka-note">Цонхны × — тэр цонхыг хаана</span>
          </div>

          <div className="bka-week" style={{ ['--hours' as string]: hours.length, ['--hour-px' as string]: `${HOUR_PX}px` }}>
            <div className="bka-week__corner" />
            {days.map((d) => (
              <div key={d.date} className="bka-week__head" data-today={d.date === today} data-closed={d.windows.length === 0}>
                {weekdayShort(d.date)}
                <b>{dayOfMonth(d.date)}</b>
              </div>
            ))}

            <div className="bka-week__hours">
              {hours.map((h) => (
                <span key={h}>{String(h).padStart(2, '0')}:00</span>
              ))}
            </div>
            {days.map((d) => (
              <DayColumn key={d.date} day={d} startHour={startHour} onCloseWindow={setClosing} />
            ))}
          </div>
        </section>

        {/* Starts at the week on screen, but never in the past. */}
        <ScheduleForm defaultFrom={monday > today ? monday : today} />
      </div>

      {closing && (
        <ConfirmDialog
          title="Цонх хаах уу?"
          message={`${closing.label}. Энэ цонхонд хийсэн захиалгууд хэвээр үлдэнэ — шинээр захиалах боломжгүй болно.`}
          confirmLabel="Хаах"
          cancelLabel="Үгүй"
          busy={busy}
          onCancel={() => setClosing(null)}
          onConfirm={() => closeWindow(closing.id)}
        />
      )}
    </>
  )
}

function DayColumn({
  day,
  startHour,
  onCloseWindow,
}: {
  day: ScheduleDay
  startHour: number
  onCloseWindow: (w: { id: string; label: string }) => void
}) {
  const top = (instant: string) => (hourOf(instant) - startHour) * HOUR_PX
  const height = (a: string, b: string) => Math.max(18, (hourOf(b) - hourOf(a) || 24 - hourOf(a)) * HOUR_PX)

  return (
    <div className="bka-week__col" data-closed={day.windows.length === 0}>
      {day.windows.map((w) => {
        const label = `${weekdayShort(day.date)} ${dayOfMonth(day.date)} · ${slotTime(w.startsAt)}–${slotTime(w.endsAt)}`
        return (
          <div key={w.id} className="bka-win" style={{ top: top(w.startsAt), height: height(w.startsAt, w.endsAt) }}>
            <span>
              {slotTime(w.startsAt)}–{slotTime(w.endsAt)}
            </span>
            <button type="button" aria-label={`Цонх хаах: ${label}`} title="Цонх хаах" onClick={() => onCloseWindow({ id: w.id, label })}>
              ×
            </button>
          </div>
        )
      })}
      {day.appointments.map((a) => (
        <Link
          key={a.id}
          to="/admin/bookings"
          search={{ from: day.date, to: day.date, id: a.id, show: a.status === 'pending' ? 'pending' : undefined }}
          className="bka-appt"
          data-status={a.status}
          style={{ top: top(a.startsAt) + 1, height: height(a.startsAt, a.endsAt) - 2 }}
          title={`${slotTime(a.startsAt)}–${slotTime(a.endsAt)} ${a.customerName} · ${a.serviceName}`}
        >
          <b>{a.customerName}</b>
          <span>
            {slotTime(a.startsAt)} {a.serviceName}
          </span>
        </Link>
      ))}
    </div>
  )
}

/**
 * Open (or close) a run of days. Several hour ranges per day are fine.
 *
 * Sent in chunks of a few days: the API writes a request's windows as one
 * insert, and D1 refuses a statement with more than 100 bound values, so a
 * month of three windows a day fails as one request. Each chunk still
 * replaces its days whole. Once the API batches its insert, CHUNK_ROWS can go.
 */
const CHUNK_ROWS = 20

function ScheduleForm({ defaultFrom }: { defaultFrom: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'open' | 'closed'>('open')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(addDays(defaultFrom, 27))
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [ranges, setRanges] = useState<Array<{ start: string; end: string }>>([
    { start: '10:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
    { start: '18:00', end: '21:00' },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const matching: string[] = []
  if (from && to && from <= to) {
    for (let d = from; d <= to && matching.length <= 93; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) matching.push(d)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(null)
    if (matching.length === 0) return setError('Сонгосон хугацаанд тохирох өдөр алга.')
    if (matching.length > 93) return setError('Нэг удаад 93 хоногоос ихгүй.')
    if (mode === 'open') {
      if (ranges.length === 0) return setError('Дор хаяж нэг цаг нэмнэ үү.')
      const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start))
      for (const [i, r] of sorted.entries()) {
        if (!r.start || !r.end || r.end <= r.start) return setError(`${r.start}–${r.end}: дуусах цаг эхлэхээсээ хойш байх ёстой.`)
        const prev = sorted[i - 1]
        if (prev && r.start < prev.end) return setError(`${prev.start}–${prev.end} ба ${r.start}–${r.end} давхцаж байна.`)
      }
    }

    // Days, in runs small enough for one request each (see CHUNK_ROWS).
    const perChunk = mode === 'open' ? Math.max(1, Math.floor(CHUNK_ROWS / ranges.length)) : 31
    const chunks: string[][] = []
    for (let i = 0; i < matching.length; i += perChunk) chunks.push(matching.slice(i, i + perChunk))

    setBusy(true)
    try {
      for (const chunk of chunks) {
        const span = { from: chunk[0]!, to: chunk.at(-1)!, weekdays }
        const entries: ScheduleEntry[] =
          mode === 'open' ? ranges.map((r) => ({ ...span, start: r.start, end: r.end })) : [{ ...span, closed: true }]
        await adminBookingApi.applySchedule(entries)
      }
      setSaved(mode === 'open' ? `${matching.length} өдрийг нээлээ.` : `${matching.length} өдрийг хаалаа.`)
      await router.invalidate()
    } catch (err) {
      setError(`${bookingErrorText(err)} Хэсэг өдөр хадгалагдсан байж магадгүй — хуваарийг шалгана уу.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="adm__card adm__pad bka-side" onSubmit={submit}>
      <div className="bka-side__head">
        <h2>{mode === 'open' ? 'Цаг нээх' : 'Өдөр хаах'}</h2>
        <div className="bka-seg" role="group" aria-label="Үйлдэл">
          <button type="button" data-active={mode === 'open'} onClick={() => setMode('open')}>
            Нээх
          </button>
          <button type="button" data-active={mode === 'closed'} onClick={() => setMode('closed')}>
            Хаах
          </button>
        </div>
      </div>

      <div className="adm__cols bka-when">
        <label className="field">
          <span>Эхлэх</span>
          <input type="date" value={from} required onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>Дуусах</span>
          <input type="date" value={to} min={from} required onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="field">
        <span>Гарагууд</span>
        <div className="bka-weekdays">
          {WEEKDAYS.map((w, i) => {
            const n = i + 1
            const on = weekdays.includes(n)
            return (
              <button
                key={w}
                type="button"
                aria-pressed={on}
                data-active={on}
                onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== n) : [...weekdays, n].sort())}
              >
                {w}
              </button>
            )
          })}
        </div>
      </div>

      {mode === 'open' && (
        <div className="field">
          <span>Цагууд</span>
          {ranges.map((r, i) => (
            <div key={i} className="bka-range">
              <input
                type="time"
                step={900}
                value={r.start}
                aria-label="Эхлэх цаг"
                onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
              />
              <span aria-hidden>—</span>
              <input
                type="time"
                step={900}
                value={r.end}
                aria-label="Дуусах цаг"
                onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
              />
              <button
                type="button"
                className="adm__iconbtn adm__iconbtn--neutral"
                aria-label="Хасах"
                title="Хасах"
                onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="linkish" onClick={() => setRanges([...ranges, { start: '18:00', end: '21:00' }])}>
            + Цаг нэмэх
          </button>
        </div>
      )}

      <p className="adm__muted bka-note">
        Сонгосон өдрүүдийн хуваарийг <b>бүхэлд нь солино</b>. Хийгдсэн захиалгад нөлөөлөхгүй.
      </p>

      {error && <p className="error">{error}</p>}
      {saved && <p className="bka-ok">{saved}</p>}

      <button type="submit" className={mode === 'open' ? 'btn' : 'btn btn--danger'} disabled={busy || matching.length === 0}>
        {busy ? 'Хадгалж байна…' : `${matching.length} өдөрт ${mode === 'open' ? 'хадгалах' : 'хаах'}`}
      </button>
    </form>
  )
}
