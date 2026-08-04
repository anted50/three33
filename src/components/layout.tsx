import { useEffect, useState } from 'react'
import { Link, useLoaderData } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { SearchBox } from './search-box'

/**
 * Header structure follows the reference site the client pointed at: a
 * dismissible utility strip, then the brand row with search/cart/account, then
 * a category row, then a secondary sort tab row on listing pages.
 *
 * The arrangement is theirs; the type, colour, copy and behaviour are ours.
 */

const STRIP_KEY = 'uc_strip_dismissed'

export function UtilityStrip() {
  /**
   * Renders on the server and stays until the client says otherwise. Reading
   * localStorage during render would differ between server and client markup
   * and trip a hydration mismatch, so the check runs in an effect and the strip
   * simply disappears a frame later for people who dismissed it.
   */
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(STRIP_KEY) === '1') setHidden(true)
  }, [])

  if (hidden) return null

  return (
    <div className="strip">
      <div className="wrap strip__bar">
        <nav className="strip__links">
          <a href="tel:+97699051483">Холбоо барих</a>
          <a
            href="https://maps.google.com/?q=Yarmag,Khan-Uul,Ulaanbaatar"
            target="_blank"
            rel="noreferrer noopener"
          >
            Салбар
          </a>
        </nav>

        <div className="strip__right">
          <a
            href="https://www.instagram.com/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Instagram
          </a>
          <a
            href="https://www.facebook.com/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Facebook
          </a>
          <button
            type="button"
            className="strip__close"
            aria-label="Хаах"
            onClick={() => {
              localStorage.setItem(STRIP_KEY, '1')
              setHidden(true)
            }}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

interface RootData {
  categories: Array<{ slug: string; nameMn: string; nameEn: string }>
  cartCount: number
}

export function Header() {
  // Loaded once in the root route rather than by every page that renders a
  // header — the category row is on all of them.
  const data = useLoaderData({ from: '__root__' }) as RootData

  return (
    <header className="header">
      <div className="wrap header__bar">
        <Link to="/" className="logo">
          Three 33 <span>× Uppercut</span>
        </Link>

        <div className="header__search">
          <SearchBox />
        </div>

        <div className="header__actions">
          <Link
            to="/products"
            className="icon-btn header__searchbtn"
            aria-label="Хайх"
          >
            <SearchIcon />
          </Link>
          <Link to="/cart" className="icon-btn" aria-label="Сагс">
            <CartIcon />
            {data.cartCount > 0 && (
              <span className="badge">{data.cartCount}</span>
            )}
          </Link>
        </div>
      </div>

      {/* Category row, as on the reference site. Scrolls horizontally on a phone. */}
      <nav className="catnav">
        <div className="wrap catnav__inner">
          <Link
            to="/products"
            search={(prev) => ({ ...prev, category: undefined })}
            className="catnav__link"
            activeOptions={{ exact: true, includeSearch: false }}
          >
            Бүгд
          </Link>
          {data.categories.map((c) => (
            <Link
              key={c.slug}
              to="/products"
              search={(prev) => ({ ...prev, category: c.slug })}
              className="catnav__link"
            >
              {c.nameEn.toUpperCase()}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}

const SORTS = [
  { key: undefined, label: 'Онцлох' },
  { key: 'new' as const, label: 'Шинэ' },
  { key: 'bestseller' as const, label: 'Бестселлер' },
]

/** Secondary tab row: Featured / New / Bestseller. */
export function SortTabs({ current }: { current?: string }) {
  return (
    <div className="tabs" role="tablist">
      {SORTS.map((sort) => {
        const active = (current ?? undefined) === sort.key
        return (
          <Link
            key={sort.label}
            to="/products"
            search={(prev: Record<string, unknown>) => ({
              ...prev,
              sort: sort.key,
            })}
            className="tabs__tab"
            role="tab"
            aria-selected={active}
            data-active={active}
          >
            {sort.label}
          </Link>
        )
      })}
    </div>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__links">
          <Link to="/products">Бүтээгдэхүүн</Link>
          <a href="tel:+97699051483">Холбоо барих</a>
        </div>
        <p>Three 33 Barbershop — Uppercut Deluxe албан ёсны борлуулагч.</p>
        <p>Хан-Уул дүүрэг, 24-р хороо, Яармаг, Улаанбаатар.</p>
      </div>
    </footer>
  )
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <UtilityStrip />
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  )
}

/** Inline SVGs — no external icon font, so nothing to block under a strict CSP. */
function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m20 20-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.5a1 1 0 0 0 1-.78L20 8H6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  )
}
