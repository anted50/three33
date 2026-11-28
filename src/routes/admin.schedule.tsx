import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { ChevronLeftIcon, ChevronRightIcon } from '~/components/admin-icons'
import { BookingLoadFailed, bookingErrorText } from '~/components/admin-booking'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { assert } from '~/lib/assert'
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
  week: z.iso.date().optional().catch(undefined),
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
  errorComponent: BookingLoadFailed,
  component: Schedule,
})

const HOUR_PX = 48
const WEEKDAYS = ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня']

/**
 * Most days one schedule request may touch: the API's limit
 * (MAX_SCHEDULE_DAYS in schedule-plan.ts, which imports server-only code, so
 * it is repeated here).
 */
const SCHEDULE_DAYS_MAX = 93

/** Hours of the day as a decimal in Ulaanbaatar time: 14:30 → 14.5 */
const hourOf = (instant: string) => {
  const [hours, minutes] = slotTime(instant).split(':').map(Number)
  return (hours ?? 0) + (minutes ?? 0) / 60
}

/** The grid spans the week's earliest start to latest end, at least 09–21. Midnight as an end is 24. */
function gridHours(days: ScheduleDay[]): { startHour: number; hours: number[] } {
  const blocks = days.flatMap((d) => [...d.windows, ...d.appointments])
  const startHour = Math.min(9, ...blocks.map((block) => Math.floor(hourOf(block.startsAt))))
  const endHour = Math.max(21, ...blocks.map((block) => Math.ceil(hourOf(block.endsAt) || 24)))
  assert(startHour < endHour, 'the grid spans at least 09–21')
  return { startHour, hours: Array.from({ length: endHour - startHour }, (_, index) => startHour + index) }
}

type ClosingWindow = { id: string; label: string }

function Schedule() {
  const { monday, days } = Route.useLoaderData()
  const router = useRouter()
  const [closing, setClosing] = useState<ClosingWindow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = todayUb()

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
      <WeekHeader monday={monday} />

      {error && <p className="error">{error}</p>}

      <div className="bka-split bka-split--schedule">
        <WeekGrid days={days} today={today} onCloseWindow={setClosing} />
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

function WeekHeader({ monday }: { monday: string }) {
  const navigate = Route.useNavigate()
  return (
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
  )
}

function WeekGrid({ days, today, onCloseWindow }: { days: ScheduleDay[]; today: string; onCloseWindow: (closing: ClosingWindow) => void }) {
  const { startHour, hours } = gridHours(days)
  return (
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
          {hours.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn key={d.date} day={d} startHour={startHour} onCloseWindow={onCloseWindow} />
        ))}
      </div>
    </section>
  )
}

function DayColumn({ day, startHour, onCloseWindow }: { day: ScheduleDay; startHour: number; onCloseWindow: (closing: ClosingWindow) => void }) {
  const topPx = (instant: string) => (hourOf(instant) - startHour) * HOUR_PX
  // A block ending at midnight reads 00:00; it runs to the end of the day.
  const heightPx = (startsAt: string, endsAt: string) => Math.max(18, (hourOf(endsAt) - hourOf(startsAt) || 24 - hourOf(startsAt)) * HOUR_PX)

  return (
    <div className="bka-week__col" data-closed={day.windows.length === 0}>
      {day.windows.map((w) => {
        const label = `${weekdayShort(day.date)} ${dayOfMonth(day.date)} · ${slotTime(w.startsAt)}–${slotTime(w.endsAt)}`
        return (
          <div key={w.id} className="bka-win" style={{ top: topPx(w.startsAt), height: heightPx(w.startsAt, w.endsAt) }}>
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
          style={{ top: topPx(a.startsAt) + 1, height: heightPx(a.startsAt, a.endsAt) - 2 }}
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
/** A closed day writes no windows, so a chunk of those is bounded by the day list alone. */
const CLOSED_DAYS_PER_CHUNK = 31
/** At most one chunk's worth of windows per day, so every chunk holds at least one day. */
const HOUR_RANGES_MAX = CHUNK_ROWS

type ScheduleMode = 'open' | 'closed'
type HourRange = { id: number; start: string; end: string }

// Keys for the hour-range rows, so removing one doesn't shift the others' inputs.
let hourRangeIdNext = 0
const hourRange = (start: string, end: string): HourRange => ({ id: hourRangeIdNext++, start, end })

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The days from `from` to `to` on the chosen weekdays: at most
 * SCHEDULE_DAYS_MAX + 1, enough to tell "too many" apart. The scan is bounded
 * too: with one weekday, that many matches lie within that many weeks, so a
 * far-off `to` (or no weekday at all) can't walk years of days on every
 * keystroke.
 */
function matchingDays(from: string, to: string, weekdays: number[]): string[] {
  const days: string[] = []
  const rangeIsValid = ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to
  if (!rangeIsValid) return days

  const scanDaysMax = (SCHEDULE_DAYS_MAX + 1) * 7
  let date = from
  for (let scanned = 0; scanned < scanDaysMax && date <= to; scanned++) {
    if (weekdays.includes(isoWeekday(date))) days.push(date)
    if (days.length > SCHEDULE_DAYS_MAX) break
    date = addDays(date, 1)
  }
  return days
}

/** Why these hours can't be saved, or null: each must end after it starts, and none may overlap. */
function hourRangesError(ranges: HourRange[]): string | null {
  if (ranges.length === 0) return 'Дор хаяж нэг цаг нэмнэ үү.'
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start))
  for (const [index, range] of sorted.entries()) {
    if (!range.start || !range.end || range.end <= range.start) return `${range.start}–${range.end}: дуусах цаг эхлэхээсээ хойш байх ёстой.`
    const previous = sorted[index - 1]
    if (previous && range.start < previous.end) return `${previous.start}–${previous.end} ба ${range.start}–${range.end} давхцаж байна.`
  }
  return null
}

/** The schedule change as requests small enough to send one by one (see CHUNK_ROWS). */
function scheduleRequests(change: { days: string[]; mode: ScheduleMode; weekdays: number[]; ranges: HourRange[] }): ScheduleEntry[][] {
  const { days, mode, weekdays, ranges } = change
  if (mode === 'open') assert(ranges.length > 0, 'an open change has hours')
  assert(ranges.length <= HOUR_RANGES_MAX, 'the form caps the hour ranges')
  const daysPerChunk = mode === 'open' ? Math.floor(CHUNK_ROWS / ranges.length) : CLOSED_DAYS_PER_CHUNK
  assert(daysPerChunk >= 1, 'every chunk holds at least one day')

  const requests: ScheduleEntry[][] = []
  for (let index = 0; index < days.length; index += daysPerChunk) {
    const chunk = days.slice(index, index + daysPerChunk)
    const first = chunk[0]
    const last = chunk.at(-1)
    assert(first !== undefined, 'a chunk is never empty')
    assert(last !== undefined, 'a chunk is never empty')
    const span = { from: first, to: last, weekdays }
    requests.push(mode === 'open' ? ranges.map((r) => ({ ...span, start: r.start, end: r.end })) : [{ ...span, closed: true }])
  }
  return requests
}

/** Why the form can't be sent, or null. */
function scheduleFormError({ days, mode, ranges }: { days: string[]; mode: ScheduleMode; ranges: HourRange[] }): string | null {
  if (days.length === 0) return 'Сонгосон хугацаанд тохирох өдөр алга.'
  if (days.length > SCHEDULE_DAYS_MAX) return `Нэг удаад ${SCHEDULE_DAYS_MAX} хоногоос ихгүй.`
  if (mode === 'open') return hourRangesError(ranges)
  return null
}

function ScheduleForm({ defaultFrom }: { defaultFrom: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<ScheduleMode>('open')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(addDays(defaultFrom, 27))
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [ranges, setRanges] = useState<HourRange[]>(() => [hourRange('10:00', '12:00'), hourRange('13:00', '17:00'), hourRange('18:00', '21:00')])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const days = matchingDays(from, to, weekdays)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(null)
    const problem = scheduleFormError({ days, mode, ranges })
    if (problem !== null) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      for (const entries of scheduleRequests({ days, mode, weekdays, ranges })) await adminBookingApi.applySchedule(entries)
      setSaved(mode === 'open' ? `${days.length} өдрийг нээлээ.` : `${days.length} өдрийг хаалаа.`)
      await router.invalidate()
    } catch (err) {
      setError(`${bookingErrorText(err)} Хэсэг өдөр хадгалагдсан байж магадгүй — хуваарийг шалгана уу.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="adm__card adm__pad bka-side" onSubmit={submit}>
      <ScheduleModePicker mode={mode} onChange={setMode} />

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

      <WeekdayPicker weekdays={weekdays} onChange={setWeekdays} />
      {mode === 'open' && <HourRanges ranges={ranges} onChange={setRanges} />}

      <p className="adm__muted bka-note">
        Сонгосон өдрүүдийн хуваарийг <b>бүхэлд нь солино</b>. Хийгдсэн захиалгад нөлөөлөхгүй.
      </p>

      {error && <p className="error">{error}</p>}
      {saved && <p className="bka-ok">{saved}</p>}

      <button type="submit" className={mode === 'open' ? 'btn' : 'btn btn--danger'} disabled={busy || days.length === 0}>
        {busy ? 'Хадгалж байна…' : `${days.length} өдөрт ${mode === 'open' ? 'хадгалах' : 'хаах'}`}
      </button>
    </form>
  )
}

function ScheduleModePicker({ mode, onChange }: { mode: ScheduleMode; onChange: (mode: ScheduleMode) => void }) {
  return (
    <div className="bka-side__head">
      <h2>{mode === 'open' ? 'Цаг нээх' : 'Өдөр хаах'}</h2>
      <div className="bka-seg" role="group" aria-label="Үйлдэл">
        <button type="button" data-active={mode === 'open'} onClick={() => onChange('open')}>
          Нээх
        </button>
        <button type="button" data-active={mode === 'closed'} onClick={() => onChange('closed')}>
          Хаах
        </button>
      </div>
    </div>
  )
}

function WeekdayPicker({ weekdays, onChange }: { weekdays: number[]; onChange: (weekdays: number[]) => void }) {
  return (
    <div className="field">
      <span>Гарагууд</span>
      <div className="bka-weekdays">
        {WEEKDAYS.map((label, index) => {
          const weekday = index + 1
          const on = weekdays.includes(weekday)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              data-active={on}
              onClick={() => onChange(on ? weekdays.filter((x) => x !== weekday) : [...weekdays, weekday].sort((a, b) => a - b))}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HourRanges({ ranges, onChange }: { ranges: HourRange[]; onChange: (ranges: HourRange[]) => void }) {
  const update = (id: number, fields: Partial<HourRange>) => onChange(ranges.map((r) => (r.id === id ? { ...r, ...fields } : r)))
  return (
    <div className="field">
      <span>Цагууд</span>
      {ranges.map((r) => (
        <div key={r.id} className="bka-range">
          <input type="time" step={900} value={r.start} aria-label="Эхлэх цаг" onChange={(e) => update(r.id, { start: e.target.value })} />
          <span aria-hidden>—</span>
          <input type="time" step={900} value={r.end} aria-label="Дуусах цаг" onChange={(e) => update(r.id, { end: e.target.value })} />
          <button
            type="button"
            className="adm__iconbtn adm__iconbtn--neutral"
            aria-label="Хасах"
            title="Хасах"
            onClick={() => onChange(ranges.filter((x) => x.id !== r.id))}
          >
            ×
          </button>
        </div>
      ))}
      {ranges.length < HOUR_RANGES_MAX && (
        <button type="button" className="linkish" onClick={() => onChange([...ranges, hourRange('18:00', '21:00')])}>
          + Цаг нэмэх
        </button>
      )}
    </div>
  )
}
