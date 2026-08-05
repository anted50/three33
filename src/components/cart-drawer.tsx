import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import { getCart, setCartQty, type CartView } from '~/lib/server/cart/cart'

/**
 * Cart as a slide-in drawer rather than a page.
 *
 * Adding to the cart no longer navigates away from the product you were
 * looking at, which is the whole point — on a phone especially, being thrown
 * to a separate page after every add makes buying two things tedious.
 *
 * State lives at the root so the header button and the product page can both
 * open it. Contents are fetched when it opens rather than on every page load,
 * since most visits never touch the cart.
 */

interface CartContext {
  open: boolean
  openCart: () => void
  closeCart: () => void
}

const Ctx = createContext<CartContext | null>(null)

export function useCartDrawer(): CartContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCartDrawer used outside CartProvider')
  return ctx
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const openCart = useCallback(() => setOpen(true), [])
  const closeCart = useCallback(() => setOpen(false), [])

  return (
    <Ctx.Provider value={{ open, openCart, closeCart }}>
      {children}
      <CartDrawer />
    </Ctx.Provider>
  )
}

function CartDrawer() {
  const { open, closeCart } = useCartDrawer()
  const router = useRouter()

  const [cart, setCart] = useState<CartView | null>(null)
  const [busy, setBusy] = useState(false)

  // Load on open, and reload each time it reopens — stock or prices may have
  // moved while the drawer was shut.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getCart().then((data) => {
      if (!cancelled) setCart(data)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCart()
    }
    window.addEventListener('keydown', onKey)

    /**
     * Lock the page behind the drawer. Without this, scrolling inside the
     * drawer on a phone scrolls the product grid underneath it instead once
     * the drawer's own list hits its end.
     */
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, closeCart])

  if (!open) return null

  async function change(variantId: string, qty: number) {
    setBusy(true)
    try {
      const next = await setCartQty({ data: { variantId, qty } })
      setCart(next)
      // Keeps the header count and any listing stock in step.
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  const empty = !cart || cart.lines.length === 0

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="Сагс">
      <button
        type="button"
        className="drawer__scrim"
        aria-label="Хаах"
        onClick={closeCart}
      />

      <aside className="drawer__panel">
        <header className="drawer__head">
          <h2>Сагс{cart ? ` (${cart.itemCount})` : ''}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Хаах"
            onClick={closeCart}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="drawer__body">
          {cart === null ? (
            <p className="adm__muted drawer__state">Ачааллаж байна…</p>
          ) : empty ? (
            <div className="drawer__state">
              <p>Таны сагс хоосон байна.</p>
              <Link
                to="/products"
                className="btn btn--ghost"
                onClick={closeCart}
                style={{ marginTop: 16 }}
              >
                Бүтээгдэхүүн үзэх
              </Link>
            </div>
          ) : (
            <ul className="lines">
              {cart.lines.map((line) => (
                <li key={line.variantId} className="line">
                  <div className="line__media">
                    {line.imageUrl ? (
                      <img src={line.imageUrl} alt={line.productName} />
                    ) : (
                      <span className="card__ph">{line.productName}</span>
                    )}
                  </div>

                  <div className="line__body">
                    <Link
                      to="/products/$slug"
                      params={{ slug: line.productSlug }}
                      className="line__name"
                      onClick={closeCart}
                    >
                      {line.productName}
                      {line.size ? ` ${line.size}` : ''}
                    </Link>
                    <p className="line__price">{formatMnt(line.unitPrice)}</p>

                    <div className="line__foot">
                      <div className="qty qty--sm">
                        <button
                          type="button"
                          onClick={() => change(line.variantId, line.qty - 1)}
                          disabled={busy}
                          aria-label="Хасах"
                        >
                          −
                        </button>
                        <span>{line.qty}</span>
                        <button
                          type="button"
                          onClick={() => change(line.variantId, line.qty + 1)}
                          disabled={busy || line.qty >= line.stockQty}
                          aria-label="Нэмэх"
                        >
                          +
                        </button>
                      </div>

                      <strong>{formatMnt(line.lineTotal)}</strong>
                    </div>

                    <button
                      type="button"
                      className="linkish"
                      onClick={() => change(line.variantId, 0)}
                      disabled={busy}
                    >
                      Устгах
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!empty && cart && (
          <footer className="drawer__foot">
            <div className="totals__row">
              <span>Дүн</span>
              <strong>{formatMnt(cart.subtotal)}</strong>
            </div>
            <p className="totals__note">
              Хүргэлтийн төлбөр хаягаа оруулсны дараа тооцогдоно.
            </p>
            <Link to="/checkout" className="btn" onClick={closeCart}>
              Захиалах
            </Link>
          </footer>
        )}
      </aside>
    </div>
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
