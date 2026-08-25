import { useEffect, useState } from 'react'
import { Link, useLoaderData } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Logo } from './logo'
import { SearchBox } from './search-box'
import { useCartDrawer } from './cart-drawer'

interface RootData {
    cartCount: number
}

export function Header() {
    const data = useLoaderData({ from: '__root__' }) as RootData
    const { openCart } = useCartDrawer()

    /**
     * Mobile search panel.
     *
     * Deliberately not closed on navigation: typing in the box navigates on every
     * keystroke (debounced, with replace), so closing on a location change would
     * shut the panel on the first letter typed. It closes on Escape, or by
     * tapping the icon again.
     */
    const [searchOpen, setSearchOpen] = useState(false)

    useEffect(() => {
        if (!searchOpen) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setSearchOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [searchOpen])

    return (
        <header className="header">
            <div className="wrap header__bar">
                {/*
          The mark carries no wordmark, so the shop's name has to come from the
          accessible name instead — without it the only link to the homepage
          announces as "link" and the site loses its name in the a11y tree, in
          search results' link context, and to anyone with images off.
        */}
                <Link to="/" className="logo" aria-label="Three33 Barber — нүүр">
                    <Logo className="logo__mark" />
                </Link>

                {/* Inline field, desktop only. The panel below covers mobile. */}
                <div className="header__search">
                    <SearchBox />
                </div>

                <div className="header__actions">
                    <button
                        type="button"
                        className="icon-btn header__searchbtn"
                        aria-label="Хайх"
                        aria-expanded={searchOpen}
                        onClick={() => setSearchOpen((open) => !open)}
                    >
                        {searchOpen ? <CloseIcon /> : <SearchIcon />}
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="Сагс"
                        onClick={openCart}
                    >
                        <CartIcon />
                        {data.cartCount > 0 && (
                            <span className="badge">{data.cartCount}</span>
                        )}
                    </button>
                </div>
            </div>

            {searchOpen && (
                <div className="header__panel">
                    <div className="wrap">
                        <SearchBox autoFocus />
                    </div>
                </div>
            )}
        </header>
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
                {/* Address omitted until the client confirms the shop location. */}
                <p>Three33 Barber — мэргэжлийн үс засал, сахал арчилгаа.</p>
            </div>
        </footer>
    )
}

export function Page({ children }: { children: ReactNode }) {
    return (
        <>
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

function CloseIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M6 6l12 12M18 6L6 18"
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
