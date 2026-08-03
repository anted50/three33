import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function Announce() {
  return (
    <div className="announce">
      Улаанбаатар хотод 50,000₮-с дээш захиалгад хүргэлт үнэгүй
    </div>
  )
}

export function Header({ cartCount = 0 }: { cartCount?: number }) {
  return (
    <header className="header">
      <div className="wrap header__bar">
        <Link to="/" className="logo">
          Three 33 <span>× Uppercut</span>
        </Link>

        <nav className="header__nav">
          <Link to="/">Нүүр</Link>
          <Link to="/products">Бүтээгдэхүүн</Link>
        </nav>

        <div className="header__actions">
          <Link to="/products" className="icon-btn" aria-label="Хайх">
            <SearchIcon />
          </Link>
          <Link to="/cart" className="icon-btn" aria-label="Сагс">
            <CartIcon />
            {cartCount > 0 && <span className="badge">{cartCount}</span>}
          </Link>
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__links">
          <Link to="/products">Бүтээгдэхүүн</Link>
          <Link to="/">Холбоо барих</Link>
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
      <Announce />
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  )
}

/** Inline SVGs — the CSP on the eventual host blocks external icon fonts. */
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
