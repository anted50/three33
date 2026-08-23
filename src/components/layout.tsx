import { useEffect, useState } from 'react'
import { Link, useLoaderData } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Logo } from './logo'
import { SearchBox } from './search-box'
import { useCartDrawer } from './cart-drawer'

/**
 * Header structure follows the reference site the client pointed at: a
 * dismissible utility strip, then the brand row with search/cart/account, then
 * a category row, then a secondary sort tab row on listing pages.
 *
 * The arrangement is theirs; the type, colour, copy and behaviour are ours.
 */

interface RootData {
    categories: Array<{ slug: string; nameMn: string; nameEn: string }>
    cartCount: number
}

export function Header() {
    // Loaded once in the root route rather than by every page that renders a
    // header — the category row is on all of them.
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
                <Link to="/" className="logo" aria-label="Three 33 Barbershop — нүүр">
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
