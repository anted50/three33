import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import { getCart, getShippingRates, setCartQty, type CartView } from '~/lib/server/cart/cart'
import { createOrder } from '~/lib/server/orders/create'
import { clearValidity, localizeValidity } from '~/lib/form-messages'

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
 *
 * The delivery form lives here too, not on its own page — one drawer to fill
 * in phone, e-mail, and address and pay, instead of a drawer that hands off
 * to a whole second page for three fields.
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
  const navigate = useNavigate()

  const [cart, setCart] = useState<CartView | null>(null)
  const [shippingFee, setShippingFee] = useState<number | null>(null)
  const [freeThreshold, setFreeThreshold] = useState(0)
  const [busy, setBusy] = useState(false)

  const [orderBusy, setOrderBusy] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  // Load on open, and reload each time it reopens — stock or prices may have
  // moved while the drawer was shut.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getCart().then((data) => {
      if (!cancelled) setCart(data)
    })
    void getShippingRates().then((rates) => {
      if (!cancelled) {
        setShippingFee(rates.fee)
        setFreeThreshold(rates.freeThreshold)
      }
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOrderError(null)
    setOrderBusy(true)

    const form = new FormData(event.currentTarget)

    try {
      const result = await createOrder({
        data: {
          phone: String(form.get('phone') ?? ''),
          email: String(form.get('email') ?? ''),
          address: String(form.get('address') ?? ''),
        },
      })

      closeCart()
      await navigate({
        to: '/checkout/payment/$orderNo',
        params: { orderNo: result.orderNo },
      })

      await router.invalidate()
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Захиалга үүсгэхэд алдаа гарлаа')
      setOrderBusy(false)
    }
  }

  const empty = !cart || cart.lines.length === 0
  const shipping =
    cart && shippingFee !== null
      ? cart.subtotal >= freeThreshold
        ? 0
        : shippingFee
      : null

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
            <>
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

              <form
                id="drawer-checkout-form"
                onSubmit={onSubmit}
                onInvalidCapture={localizeValidity}
                onInput={clearValidity}
                className="form drawer__form"
              >
                <h3 className="drawer__form-title">Хүргэлтийн мэдээлэл</h3>

                <label className="field">
                  <span>Утас *</span>
                  <input
                    name="phone"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    maxLength={8}
                    placeholder="99112233"
                    autoComplete="tel"
                  />
                  <small>8 оронтой дугаар</small>
                </label>

                <label className="field">
                  <span>И-мэйл</span>
                  <input name="email" type="email" autoComplete="email" />
                </label>

                <label className="field">
                  <span>Хаяг *</span>
                  <textarea
                    name="address"
                    required
                    rows={3}
                    maxLength={500}
                    minLength={5}
                    placeholder="Дүүрэг, хороо, байр, орц, тоот — хүргэлтийн жолооч олоход хангалттай бичнэ үү"
                    autoComplete="street-address"
                  />
                </label>

                {orderError && <p className="error">{orderError}</p>}
              </form>
            </>
          )}
        </div>

        {!empty && cart && (
          <footer className="drawer__foot">
            <div className="totals__row">
              <span>Дүн</span>
              <strong>{formatMnt(cart.subtotal)}</strong>
            </div>
            <div className="totals__row">
              <span>Хүргэлт</span>
              <strong>
                {shipping === null ? '…' : shipping === 0 ? 'Үнэгүй' : formatMnt(shipping)}
              </strong>
            </div>
            <div className="totals__row totals__row--grand">
              <span>Нийт</span>
              <strong>{formatMnt(cart.subtotal + (shipping ?? 0))}</strong>
            </div>
            <button
              type="submit"
              form="drawer-checkout-form"
              className="btn"
              disabled={orderBusy}
            >
              {orderBusy ? 'Түр хүлээнэ үү…' : 'Төлбөр төлөх'}
            </button>
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
