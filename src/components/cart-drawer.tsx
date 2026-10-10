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
import { sizeSuffix } from '~/lib/product-name'
import {
  getCart,
  getLiveCheckout,
  getShippingRates,
  setCartQty,
  type CartView,
} from '~/lib/server/cart/cart'
import { createOrder, getCheckoutMethods } from '~/lib/server/orders/create'
import type { ProviderName } from '~/lib/server/payments/registry'
import {
  meetsMinimum,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LOGOS,
  PAYMENT_METHOD_MIN_TOTAL,
} from '~/lib/payment-methods'
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
  /** An invoice this browser started and never finished paying. */
  const [live, setLive] = useState<{ orderNo: string; total: number } | null>(
    null,
  )

  /** Only ever grows past ['qpay'] once StorePay is actually configured — see
   * getCheckoutMethods. A radio group with one option would just be noise, so
   * the form only shows a choice once there is one. */
  const [methods, setMethods] = useState<ProviderName[]>(['qpay'])
  const [method, setMethod] = useState<ProviderName>('qpay')

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
    void getLiveCheckout().then((found) => {
      if (!cancelled) setLive(found)
    })
    void getCheckoutMethods().then((available) => {
      if (cancelled) return
      setMethods(available)
      // Don't fight a choice the customer already made in this drawer session.
      setMethod((current) => (available.includes(current) ? current : available[0]!))
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
          method: chosenMethod,
        },
      })

      closeCart()
      await navigate({
        to: '/checkout/payment/$orderNo',
        params: { orderNo: result.orderNo },
        // The cookie normally carries this; the query parameter keeps the link
        // usable if it was dropped or the page is opened elsewhere.
        search: { t: result.token },
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
  const total = (cart?.subtotal ?? 0) + (shipping ?? 0)

  /** Falls back to QPay if the cart shrank under the picked method's minimum
   * after it was chosen, rather than submitting a choice the server rejects. */
  const chosenMethod: ProviderName = meetsMinimum(method, total) ? method : 'qpay'

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
          {/*
            The way back to an abandoned QR. Without it a customer who closed
            the payment page had nothing left pointing at it — no account, no
            order list, and the receipt e-mail only goes out once the money has
            actually landed.
          */}
          {live && (
            <div className="drawer__resume">
              <p>
                Төлөгдөөгүй захиалга <strong>{live.orderNo}</strong> ·{' '}
                {formatMnt(live.total)}
              </p>
              <Link
                to="/checkout/payment/$orderNo"
                params={{ orderNo: live.orderNo }}
                search={{ t: undefined }}
                className="btn btn--ghost"
                onClick={closeCart}
              >
                Төлбөрөө үргэлжлүүлэх
              </Link>
            </div>
          )}

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
                        {sizeSuffix(line.productName, line.size)}
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

                {methods.length > 1 && (
                  <fieldset className="field field--method">
                    <legend>Төлбөрийн хэлбэр</legend>
                    <div className="method-options">
                      {methods.map((option) => {
                        const allowed = meetsMinimum(option, total)
                        const selected = chosenMethod === option
                        return (
                          <label
                            key={option}
                            className={`field__radio${selected ? ' field__radio--selected' : ''}${allowed ? '' : ' field__radio--disabled'}`}
                          >
                            <input
                              type="radio"
                              name="method-choice"
                              checked={selected}
                              disabled={!allowed}
                              onChange={() => setMethod(option)}
                            />
                            <img
                              src={PAYMENT_METHOD_LOGOS[option]}
                              alt=""
                              width={20}
                              height={20}
                              className="field__radio-logo"
                            />
                            <span>{PAYMENT_METHOD_LABELS[option]}</span>
                          </label>
                        )
                      })}
                    </div>
                    {methods.map((option) => {
                      const min = PAYMENT_METHOD_MIN_TOTAL[option]
                      if (min === undefined || meetsMinimum(option, total)) return null
                      return (
                        <small key={option}>
                          {PAYMENT_METHOD_LABELS[option]} {formatMnt(min)}-с дээш
                          захиалгад боломжтой
                        </small>
                      )
                    })}
                  </fieldset>
                )}

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
