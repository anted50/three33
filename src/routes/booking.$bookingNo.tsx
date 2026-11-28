import { useEffect, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { BookingBar, BookingShell, BookingTitle, PhoneCopyBar } from '~/components/booking/shell'
import { PhoneCopy } from '~/components/phone-copy'
import { CalendarIcon, CheckIcon, ClockIcon, PinIcon } from '~/components/booking/icons'
import { SummaryCard } from '~/components/booking/summary'
import { assert } from '~/lib/assert'
import { BookingApiError, bookingApi, loadFailureHint } from '~/lib/booking/api'
import type { BookingStatus } from '~/lib/booking/api'
import { dayTitle, formatDuration, localDateOf, slotTime } from '~/lib/booking/calendar'
import { heldBooking } from '~/lib/booking/held'
import { bookingIcs, downloadIcs } from '~/lib/booking/ics'
import { SHOP } from '~/lib/booking/shop'
import { formatCountdown } from '~/lib/countdown'
import { formatMnt } from '~/lib/money'

/**
 * One booking, opened with its private token: the QPay fee while the time is
 * held, then the confirmation. `?t=` is normally in the URL; if it isn't (a
 * link typed by hand), the copy remembered in this browser is used.
 */

const searchSchema = z.object({ t: z.string().min(10).max(100).optional().catch(undefined) })

export const Route = createFileRoute('/booking/$bookingNo')({
  ssr: false,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ params, deps }) => {
    const held = heldBooking()
    const token = deps.t ?? (held?.bookingNo === params.bookingNo ? held.token : undefined)
    if (!token) return { kind: 'gone' as const }
    try {
      return { kind: 'found' as const, token, booking: await bookingApi.status(params.bookingNo, token) }
    } catch (error) {
      // A wrong token and an unpaid hold that was swept look the same: gone.
      if (error instanceof BookingApiError && error.status === 404) return { kind: 'gone' as const }
      throw error
    }
  },
  component: BookingPage,
  pendingComponent: BookingPageLoading,
  errorComponent: BookingPageFailed,
})

/** Must match HOLD_MS in booking/book.ts; only drives the progress line. */
const HOLD_MS = 15 * 60 * 1000

/**
 * Poll cadence, backing off — the same reasoning as checkout: fast while the
 * customer is in their bank app, slower if the page was left open. The server
 * asks QPay at most every 3 s per booking whatever this does.
 */
const POLL_STEPS_MS = [3000, 3000, 3000, 3000, 3000, 6000, 6000, 12000]
const POLL_MAX_MS = 15000
const pollDelay = (attempt: number) => POLL_STEPS_MS[attempt] ?? POLL_MAX_MS

/**
 * A backstop, not the usual stop: polling ends when the hold expires. A
 * 15-minute hold is under 80 polls at this cadence.
 */
const POLL_ATTEMPTS_MAX = 120

function BookingPage() {
  const data = Route.useLoaderData()
  if (data.kind === 'gone') return <Expired />
  const { booking, token } = data
  if (booking.state === 'confirmed') return <Confirmed booking={booking} />
  if (booking.state === 'cancelled') return <Cancelled booking={booking} />
  return <Payment booking={booking} token={token} />
}

function Payment({ booking, token }: { booking: BookingStatus; token: string }) {
  // A hold without an expiry cannot be paid: treat it as long lapsed.
  const expiresAt = booking.expiresAt ? new Date(booking.expiresAt).getTime() : 0
  const now = useClock(expiresAt)
  const expired = now >= expiresAt
  const { check, checking, checkNow } = useFeeCheck(booking.bookingNo, token)

  useFeePolling(check, expired)

  if (expired) return <Expired onCheck={checkNow} checking={checking} />

  return (
    <BookingShell>
      <div className="bk-flow" data-step="pay">
        <div className="bk-flow__main">
          <section className="bk-sec">
            <BookingTitle>Төлбөр төлөх</BookingTitle>
            <HoldTimer msLeft={expiresAt - now} />
            <FeeInvoice booking={booking} />
          </section>
        </div>

        <SummaryCard
          service={booking.service}
          startsAt={booking.startsAt}
          endsAt={booking.endsAt}
          price={null}
          fee={booking.bookingFee}
          note="Төлбөр орж ирмэгц захиалга автоматаар баталгаажна."
        >
          <BookingBar
            tone="light"
            label="Төлбөр хүлээж байна…"
            value={checking ? 'Шалгаж байна' : 'Шалгах'}
            onClick={checkNow}
            disabled={checking}
          />
        </SummaryCard>
      </div>
    </BookingShell>
  )
}

/** The current time, ticking each second until `until` has passed. */
function useClock(until: number): number {
  assert(Number.isFinite(until), 'a hold has a finite expiry')
  const [now, setNow] = useState(() => Date.now())
  const over = now >= until

  useEffect(() => {
    if (over) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [over])

  return now
}

/**
 * One fee check, for the poll and for the "Шалгах" button. A confirmed fee,
 * a released hold or a swept one (404) reloads the route, whose loader then
 * shows the right screen. Returns whether it did.
 */
function useFeeCheck(bookingNo: string, token: string) {
  const router = useRouter()
  const [checking, setChecking] = useState(false)

  async function check(): Promise<boolean> {
    try {
      const result = await bookingApi.check(bookingNo, token)
      if (result.status === 'pending') return false
    } catch (error) {
      const gone = error instanceof BookingApiError && error.status === 404
      if (!gone) {
        // Not fatal: the next check may well work.
        console.warn('Booking fee check failed', error)
        return false
      }
    }
    await router.invalidate()
    return true
  }

  async function checkNow() {
    if (checking) return
    setChecking(true)
    try {
      await check()
    } finally {
      setChecking(false)
    }
  }

  return { check, checking, checkNow }
}

/** Checks on the backing-off cadence until the hold lapses or a check settles it. */
function useFeePolling(check: () => Promise<boolean>, expired: boolean) {
  useEffect(() => {
    if (expired) return
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      if (cancelled) return
      if (attempts >= POLL_ATTEMPTS_MAX) return
      timer = setTimeout(poll, pollDelay(attempts))
    }
    const poll = async () => {
      attempts += 1
      assert(attempts <= POLL_ATTEMPTS_MAX, 'polling is bounded')
      if (await check()) return
      schedule()
    }

    schedule()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when expiry flips
  }, [expired])
}

function HoldTimer({ msLeft }: { msLeft: number }) {
  const share = Math.max(0, Math.min(100, (msLeft / HOLD_MS) * 100))
  return (
    <div className="bk-timer" role="timer" aria-label="Төлөх хугацаа">
      <div className="bk-timer__left">
        <span className="bk-timer__label">ЦАГИЙГ ТАНЬ ХАДГАЛЖ БАЙНА</span>
        <span className="bk-timer__track">
          <i style={{ width: `${share}%` }} />
        </span>
      </div>
      <b className="bk-timer__clock">{formatCountdown(msLeft).padStart(5, '0')}</b>
    </div>
  )
}

/** The QR for desktop, the bank apps' deep links for a phone. */
function FeeInvoice({ booking }: { booking: BookingStatus }) {
  const invoice = booking.invoice
  return (
    <div className="bk-pay">
      {invoice?.qrImage && (
        <div className="bk-card bk-qr">
          <img src={`data:image/png;base64,${invoice.qrImage}`} alt={`QPay QR — ${booking.bookingNo}`} width={220} height={220} />
          <b className="bk-qr__amount">{formatMnt(booking.bookingFee)}</b>
        </div>
      )}
      {invoice && invoice.links.length > 0 && (
        <div className="bk-banks">
          <p className="bk-muted">Банкны аппаар төлөх</p>
          <ul className="bk-banks__list">
            {invoice.links.map((link) => (
              <li key={link.name}>
                <a href={link.link} className="bk-bank">
                  {link.logo ? <img src={link.logo} alt="" width={48} height={48} loading="lazy" /> : <span className="bk-bank__dot" />}
                  <span>{link.description || link.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Confirmed({ booking }: { booking: BookingStatus }) {
  const held = heldBooking()
  const email = held?.bookingNo === booking.bookingNo ? held.email : undefined
  const minutes = Math.round((new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime()) / 60_000)

  return (
    <BookingShell band={false}>
      <div className="bk-done">
        <div className="bk-done__head">
          <span className="bk-okbox">
            <CheckIcon size={30} />
          </span>
          <BookingTitle sub={email ? `Баталгаажуулалтыг ${email} руу илгээлээ.` : 'Баталгаажуулах и-мэйл илгээлээ.'}>
            Баталгаажлаа
          </BookingTitle>
          <p className="bk-muted bk-done__no">
            Захиалга № {booking.bookingNo} · Өөрчлөх бол <PhoneCopy />
          </p>
        </div>

        <div className="bk-card bk-done__card">
          <div className="bk-row">
            <ClockIcon />
            <div>
              <div className="bk-row__v">
                {dayTitle(localDateOf(new Date(booking.startsAt)))} · {slotTime(booking.startsAt)}
              </div>
              <div className="bk-row__k">
                {booking.service} · {formatDuration(minutes)}
              </div>
            </div>
          </div>
          <div className="bk-row">
            <PinIcon />
            <div>
              <div className="bk-row__v">{SHOP.address}</div>
              <div className="bk-row__k">{SHOP.district}</div>
            </div>
          </div>
          <div className="bk-row">
            <span className="bk-ok">
              <CheckIcon size={20} />
            </span>
            <div>
              <div className="bk-row__v">{formatMnt(booking.bookingFee)} төлсөн</div>
              <div className="bk-row__k">Үлдэгдлийг газар дээр нь төлнө</div>
            </div>
          </div>
        </div>

        <div className="bk-done__bar">
          <BookingBar
            label={
              <>
                <CalendarIcon /> Календарьт нэмэх
              </>
            }
            onClick={() => downloadIcs(`three33-${booking.bookingNo}.ics`, bookingIcs(booking))}
          />
        </div>
      </div>
    </BookingShell>
  )
}

/**
 * The hold lapsed, or the link points at nothing. An unpaid hold is deleted,
 * so "never paid" and "expired" are one screen. A payment that lands at the
 * last second is still caught: "Төлбөр шалгах" asks QPay once more.
 */
function Expired({ onCheck, checking }: { onCheck?: () => void; checking?: boolean }) {
  return (
    <BookingShell band={false}>
      <div className="bk-center">
        <div className="bk-center__clock">00:00</div>
        <h2 className="bk-center__title">Хугацаа дууслаа</h2>
        <p className="bk-muted">15 минутад төлбөр ороогүй тул цагийг чөлөөллөө. Таны данснаас мөнгө хасагдаагүй.</p>
        <div className="bk-center__actions">
          {onCheck && <BookingBar tone="light" label={checking ? 'Шалгаж байна…' : 'Төлбөр шалгах'} onClick={onCheck} disabled={checking} />}
          <Link to="/booking" className="bk-bar" data-tone="dark">
            <span className="bk-bar__label">Дахин захиалах</span>
            <span className="bk-bar__value">→</span>
          </Link>
        </div>
      </div>
    </BookingShell>
  )
}

function Cancelled({ booking }: { booking: BookingStatus }) {
  return (
    <BookingShell band={false}>
      <div className="bk-center">
        <h2 className="bk-center__title">Захиалга цуцлагдсан</h2>
        <p className="bk-muted">
          {dayTitle(localDateOf(new Date(booking.startsAt)))} {slotTime(booking.startsAt)}-ын захиалга цуцлагдсан байна. Асуух зүйл
          байвал залгана уу.
        </p>
        <div className="bk-center__actions">
          <PhoneCopyBar />
          <Link to="/booking" className="bk-bar" data-tone="light">
            <span className="bk-bar__label">Шинэ цаг захиалах</span>
          </Link>
        </div>
      </div>
    </BookingShell>
  )
}

function BookingPageLoading() {
  return (
    <BookingShell band={false}>
      <div className="bk-flow">
        <div className="bk-flow__main">
          <div className="bk-skeleton" aria-busy="true" aria-label="Ачаалж байна" />
        </div>
      </div>
    </BookingShell>
  )
}

function BookingPageFailed({ error }: { error: unknown }) {
  const router = useRouter()
  return (
    <BookingShell band={false}>
      <div className="bk-center">
        <h2 className="bk-center__title">Ачаалж чадсангүй</h2>
        <p className="bk-muted">{loadFailureHint(error)}</p>
        <div className="bk-center__actions">
          <BookingBar label="Дахин оролдох" onClick={() => void router.invalidate()} />
        </div>
      </div>
    </BookingShell>
  )
}
