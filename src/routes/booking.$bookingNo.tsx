import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { BookingBar, BookingShell, BookingTitle } from '~/components/booking/shell'
import { CalendarIcon, CheckIcon, ClockIcon, PhoneIcon, PinIcon } from '~/components/booking/icons'
import { SummaryCard } from '~/components/booking/summary'
import { BookingApiError, bookingApi } from '~/lib/booking/api'
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
  pendingComponent: () => (
    <BookingShell band={false}>
      <div className="bk-flow">
        <div className="bk-flow__main">
          <div className="bk-skeleton" aria-busy="true" aria-label="Ачаалж байна" />
        </div>
      </div>
    </BookingShell>
  ),
  errorComponent: () => {
    const router = useRouter()
    return (
      <BookingShell band={false}>
        <div className="bk-center">
          <h2 className="bk-center__title">Ачаалж чадсангүй</h2>
          <p className="bk-muted">Интернэт холболтоо шалгаад дахин оролдоно уу.</p>
          <div className="bk-center__actions">
            <BookingBar label="Дахин оролдох" onClick={() => router.invalidate()} />
          </div>
        </div>
      </BookingShell>
    )
  },
})

/** Must match HOLD_MS in booking/book.ts; only drives the progress line. */
const HOLD_MS = 15 * 60 * 1000

/**
 * Poll cadence, backing off — the same reasoning as checkout: fast while the
 * customer is in their bank app, slower if the page was left open. The server
 * asks QPay at most every 3 s per booking whatever this does.
 */
const POLL_STEPS_MS = [3000, 3000, 3000, 3000, 3000, 6000, 6000, 12000]
const pollDelay = (tick: number) => POLL_STEPS_MS[tick] ?? 15000

function BookingPage() {
  const data = Route.useLoaderData()
  if (data.kind === 'gone') return <Expired />
  const { booking, token } = data
  if (booking.state === 'confirmed') return <Confirmed booking={booking} />
  if (booking.state === 'cancelled') return <Cancelled booking={booking} />
  return <Payment booking={booking} token={token} />
}

function Payment({ booking, token }: { booking: BookingStatus; token: string }) {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  const [checking, setChecking] = useState(false)
  const expiresAt = booking.expiresAt ? new Date(booking.expiresAt).getTime() : now
  const expired = now >= expiresAt
  const tick = useRef(0)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  /** One check; a confirmed fee (or a swept hold) reloads the page's state. */
  async function check(): Promise<boolean> {
    try {
      const result = await bookingApi.check(booking.bookingNo, token)
      if (result.status !== 'pending') {
        await router.invalidate()
        return true
      }
    } catch (error) {
      if (error instanceof BookingApiError && error.status === 404) {
        await router.invalidate()
        return true
      }
      // Anything else: keep polling; the next tick may well work.
    }
    return false
  }

  useEffect(() => {
    if (expired) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (await check()) return
      if (!cancelled) timer = setTimeout(poll, pollDelay(tick.current++))
    }
    timer = setTimeout(poll, pollDelay(tick.current++))
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when expiry flips
  }, [expired])

  async function checkNow() {
    setChecking(true)
    await check()
    setChecking(false)
  }

  if (expired) return <Expired onCheck={checkNow} checking={checking} />

  const invoice = booking.invoice
  const left = expiresAt - now

  return (
    <BookingShell>
      <div className="bk-flow" data-step="pay">
        <div className="bk-flow__main">
          <section className="bk-sec">
            <BookingTitle>Төлбөр төлөх</BookingTitle>

            <div className="bk-timer" role="timer" aria-label="Төлөх хугацаа">
              <div className="bk-timer__left">
                <span className="bk-timer__label">ЦАГИЙГ ТАНЬ ХАДГАЛЖ БАЙНА</span>
                <span className="bk-timer__track">
                  <i style={{ width: `${Math.max(0, Math.min(100, (left / HOLD_MS) * 100))}%` }} />
                </span>
              </div>
              <b className="bk-timer__clock">{formatCountdown(left).padStart(5, '0')}</b>
            </div>

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
            Захиалга № {booking.bookingNo} · Өөрчлөх бол <a href={SHOP.tel}>{SHOP.phone}</a>
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
          <BookingBar
            href={SHOP.tel}
            label={
              <>
                <PhoneIcon size={18} /> Залгах
              </>
            }
            value={SHOP.phone}
          />
          <Link to="/booking" className="bk-bar" data-tone="light">
            <span className="bk-bar__label">Шинэ цаг захиалах</span>
          </Link>
        </div>
      </div>
    </BookingShell>
  )
}
