import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Footer, Header } from '~/components/layout'
import { SHOP } from '~/lib/booking/shop'
import { BackIcon } from './icons'

/**
 * The booking pages' frame.
 *
 * Desktop keeps the storefront around the flow — site header, the barber
 * photo band, the footer — so booking still feels like Three33. On a phone
 * all of that is hidden (booking.css): one job per screen, a big title and a
 * bar at the bottom, the way Squire does it.
 */
export function BookingShell({ children, band = true }: { children: ReactNode; band?: boolean }) {
  return (
    <div className="bk">
      <Header />
      {band && (
        <section className="bk-band">
          <img src="/hero-road-to-barber-1200.webp" alt="" className="bk-band__photo" />
          <div className="bk-band__in">
            <p className="bk-band__eyebrow">Онлайн цаг захиалга</p>
            <h1 className="bk-band__title">Цаг захиалах</h1>
            <p className="bk-band__meta">
              <span>Нэг сандал · нэг барбер</span>
              <span>{SHOP.address}</span>
              <span>{SHOP.phone}</span>
            </p>
          </div>
        </section>
      )}
      <main className="bk-main">{children}</main>
      <Footer />
    </div>
  )
}

/** The big title, with a back arrow when there is a step to go back to. */
export function BookingTitle({ children, onBack, sub }: { children: ReactNode; onBack?: () => void; sub?: ReactNode }) {
  return (
    <header className="bk-title">
      <h2 className="bk-title__h">
        {onBack && (
          <button type="button" className="bk-title__back" onClick={onBack} aria-label="Буцах">
            <BackIcon />
          </button>
        )}
        {children}
      </h2>
      {sub && <p className="bk-title__sub">{sub}</p>}
    </header>
  )
}

/**
 * The black bar: fixed to the bottom of a phone screen, inline under the
 * summary on desktop. `label` left, `value` right, like Squire's "View Order $1".
 */
export function BookingBar({
  label,
  value,
  onClick,
  disabled,
  tone = 'dark',
  type = 'button',
  form,
  href,
}: {
  label: ReactNode
  value?: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'dark' | 'red' | 'light'
  type?: 'button' | 'submit'
  form?: string
  /** A plain link instead of a button — for tel: and the like. */
  href?: string
}) {
  if (href) {
    return (
      <a href={href} className="bk-bar" data-tone={tone}>
        <span className="bk-bar__label">{label}</span>
        {value !== undefined && <span className="bk-bar__value">{value}</span>}
      </a>
    )
  }
  return (
    <button type={type} form={form} className="bk-bar" data-tone={tone} onClick={onClick} disabled={disabled}>
      <span className="bk-bar__label">{label}</span>
      {value !== undefined && <span className="bk-bar__value">{value}</span>}
    </button>
  )
}

/** Matches booking.css's breakpoint, so JS and CSS agree on which layout is up. */
export const DESKTOP_QUERY = '(min-width: 1000px)'

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return desktop
}
