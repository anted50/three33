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
import { usePostHog } from '@posthog/react'
import { assert } from '~/lib/assert'
import { formatMnt } from '~/lib/money'
import { sizeSuffix } from '~/lib/product-name'
import {
  addToCart,
  getCart,
  getLiveCheckout,
  getShippingRates,
  setCartQty,
  type CartLine,
  type CartView,
} from '~/lib/server/cart/cart'
import {
  listCartSuggestions,
  type CartSuggestion,
} from '~/lib/server/products/queries'
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

/** The shipping rates the server will charge; see getShippingRates. */
interface ShippingRates {
  fee: number
  freeThreshold: number
}

/** An invoice this browser started and never finished paying. */
interface LiveCheckout {
  orderNo: string
  total: number
}

function CartDrawer() {
  const { open, closeCart } = useCartDrawer()
  const contents = useDrawerContents(open)
  const { cart, rates } = contents
  const [method, setMethod] = useState<ProviderName>('qpay')
  const order = useCreateOrder(closeCart)

  useDrawerChrome(open, closeCart)

  if (!open) return null

  const empty = !cart || cart.lines.length === 0
  const shipping = cart && rates ? shippingFor(cart.subtotal, rates) : null
  const total = (cart?.subtotal ?? 0) + (shipping ?? 0)

  const chosenMethod = chooseMethod(method, contents.methods, total)

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="Сагс">
      <button
        type="button"
        className="drawer__scrim"
        aria-label="Хаах"
        onClick={closeCart}
      />

      <aside className="drawer__panel">
        <DrawerHead cart={cart} onClose={closeCart} />

        <div className="drawer__body">
          {contents.live && (
            <ResumeCheckout live={contents.live} onLeave={closeCart} />
          )}

          {cart === null ? (
            <CartLoading failed={contents.cartFailed} />
          ) : empty ? (
            <EmptyCart
              suggestions={contents.suggestions}
              onAdded={contents.setCart}
              onLeave={closeCart}
            />
          ) : (
            <>
              <CartLines
                lines={cart.lines}
                onChanged={contents.setCart}
                onLeave={closeCart}
              />
              <CheckoutForm
                methods={contents.methods}
                chosenMethod={chosenMethod}
                total={total}
                orderError={order.orderError}
                onPickMethod={setMethod}
                onSubmit={(event) => void order.submit(event, chosenMethod)}
              />
            </>
          )}
        </div>

        {!empty && cart && (
          <CartTotals
            subtotal={cart.subtotal}
            shipping={shipping}
            submitting={order.submitting}
          />
        )}
      </aside>
    </div>
  )
}

function DrawerHead({
  cart,
  onClose,
}: {
  cart: CartView | null
  onClose: () => void
}) {
  return (
    <header className="drawer__head">
      <h2>Сагс{cart ? ` (${cart.itemCount})` : ''}</h2>
      <button
        type="button"
        className="icon-btn"
        aria-label="Хаах"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </header>
  )
}

/** Before the cart has arrived: a wait, or why it never will. */
function CartLoading({ failed }: { failed: boolean }) {
  if (failed) {
    return <p className="error">Сагсыг ачаалж чадсангүй. Дахин нээж үзнэ үү.</p>
  }
  return <p className="adm__muted drawer__state">Ачааллаж байна…</p>
}

/**
 * The method checkout submits. Falls back to QPay — always offered — if the
 * picked method is not on offer, or the cart shrank under its minimum after
 * it was chosen, rather than submitting a choice the server rejects.
 */
function chooseMethod(
  picked: ProviderName,
  offered: ProviderName[],
  total: number,
): ProviderName {
  if (offered.includes(picked) && meetsMinimum(picked, total)) return picked
  return 'qpay'
}

/** Free at or above the threshold, the flat fee under it. */
function shippingFor(subtotal: number, rates: ShippingRates): number {
  assert(rates.fee >= 0, 'the shipping fee is never negative')
  if (subtotal >= rates.freeThreshold) return 0
  return rates.fee
}

/**
 * The drawer's server data, loaded on open and again each time it reopens —
 * stock or prices may have moved while the drawer was shut.
 *
 * All five requests start together, so the suggestions arrive with the empty
 * state instead of popping in a round trip later. Only the cart itself is
 * essential: when it fails the drawer says so. The rest are extras — a
 * failure is logged and the drawer shows without them, on safe defaults
 * (no shipping quote, no resume link, QPay only, no suggestions).
 */
function useDrawerContents(open: boolean) {
  const [cart, setCart] = useState<CartView | null>(null)
  const [cartFailed, setCartFailed] = useState(false)
  const [rates, setRates] = useState<ShippingRates | null>(null)
  const [live, setLive] = useState<LiveCheckout | null>(null)
  /** Only ever grows past ['qpay'] once StorePay is actually configured — see
   * getCheckoutMethods. A radio group with one option would just be noise, so
   * the form only shows a choice once there is one. */
  const [methods, setMethods] = useState<ProviderName[]>(['qpay'])
  /** Shown under an empty cart; see listCartSuggestions. */
  const [suggestions, setSuggestions] = useState<CartSuggestion[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCartFailed(false)

    getCart().then(
      (found) => {
        if (!cancelled) setCart(found)
      },
      (error: unknown) => {
        console.error('Cart failed to load', error)
        if (!cancelled) setCartFailed(true)
      },
    )
    getShippingRates().then(
      (found) => {
        if (!cancelled) setRates(found)
      },
      (error: unknown) => console.error('Shipping rates failed to load', error),
    )
    getLiveCheckout().then(
      (found) => {
        if (!cancelled) setLive(found)
      },
      (error: unknown) => console.error('Live checkout failed to load', error),
    )
    getCheckoutMethods().then(
      (found) => {
        assert(found.includes('qpay'), 'QPay is always offered')
        if (!cancelled) setMethods(found)
      },
      (error: unknown) => console.error('Checkout methods failed to load', error),
    )
    listCartSuggestions().then(
      (found) => {
        if (!cancelled) setSuggestions(found)
      },
      (error: unknown) => {
        console.error('Cart suggestions failed to load', error)
        if (!cancelled) setSuggestions([])
      },
    )

    return () => {
      cancelled = true
    }
  }, [open])

  return { cart, setCart, cartFailed, rates, live, methods, suggestions }
}

/** Escape closes the drawer, and the page behind it is locked while open. */
function useDrawerChrome(open: boolean, closeCart: () => void) {
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
}

/**
 * The way back to an abandoned QR. Without it a customer who closed the
 * payment page had nothing left pointing at it — no account, no order list,
 * and the receipt e-mail only goes out once the money has actually landed.
 */
function ResumeCheckout({
  live,
  onLeave,
}: {
  live: LiveCheckout
  onLeave: () => void
}) {
  return (
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
        onClick={onLeave}
      >
        Төлбөрөө үргэлжлүүлэх
      </Link>
    </div>
  )
}

function EmptyCart({
  suggestions,
  onAdded,
  onLeave,
}: {
  suggestions: CartSuggestion[]
  onAdded: (cart: CartView) => void
  onLeave: () => void
}) {
  return (
    <>
      <div className="drawer__state">
        <p>Таны сагс хоосон байна.</p>
        <Link
          to="/products"
          className="btn btn--ghost"
          onClick={onLeave}
          style={{ marginTop: 16 }}
        >
          Бүтээгдэхүүн үзэх
        </Link>
      </div>

      {suggestions.length > 0 && (
        <CartSuggestions
          suggestions={suggestions}
          onAdded={onAdded}
          onLeave={onLeave}
        />
      )}
    </>
  )
}

/**
 * The cart's lines with their quantity controls. One change at a time: every
 * control is disabled while a change is in flight, so two taps cannot race
 * each other to the server.
 */
function CartLines({
  lines,
  onChanged,
  onLeave,
}: {
  lines: CartLine[]
  onChanged: (cart: CartView) => void
  onLeave: () => void
}) {
  const posthog = usePostHog()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

  async function change(variantId: string, qty: number) {
    assert(!busy, 'one quantity change is in flight at a time')
    assert(qty >= 0, 'a quantity is never negative')
    setChangeError(null)
    setBusy(true)
    try {
      const next = await setCartQty({ data: { variantId, qty } })
      onChanged(next)
      posthog?.capture('cart_quantity_changed', {
        quantity: qty,
        variant_id: variantId,
      })
      // Keeps the header count and any listing stock in step.
      await router.invalidate()
    } catch (error) {
      setChangeError(error instanceof Error ? error.message : 'Сагсыг шинэчлэхэд алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {changeError && <p className="error">{changeError}</p>}
      <ul className="lines">
        {lines.map((line) => (
          <CartLineItem
            key={line.variantId}
            line={line}
            busy={busy}
            onChange={(qty) => void change(line.variantId, qty)}
            onLeave={onLeave}
          />
        ))}
      </ul>
    </>
  )
}

function CartLineItem({
  line,
  busy,
  onChange,
  onLeave,
}: {
  line: CartLine
  busy: boolean
  onChange: (qty: number) => void
  onLeave: () => void
}) {
  return (
    <li className="line">
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
          onClick={onLeave}
        >
          {line.productName}
          {sizeSuffix(line.productName, line.size)}
        </Link>
        <p className="line__price">{formatMnt(line.unitPrice)}</p>

        <div className="line__foot">
          <div className="qty qty--sm">
            <button
              type="button"
              onClick={() => onChange(line.qty - 1)}
              disabled={busy}
              aria-label="Хасах"
            >
              −
            </button>
            <span>{line.qty}</span>
            <button
              type="button"
              onClick={() => onChange(line.qty + 1)}
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
          onClick={() => onChange(0)}
          disabled={busy}
        >
          Устгах
        </button>
      </div>
    </li>
  )
}

/**
 * Delivery details and the payment choice. Submitted by the footer's button
 * (form="drawer-checkout-form"), which sits outside the scrolling body.
 */
function CheckoutForm({
  methods,
  chosenMethod,
  total,
  orderError,
  onPickMethod,
  onSubmit,
}: {
  methods: ProviderName[]
  chosenMethod: ProviderName
  total: number
  orderError: string | null
  onPickMethod: (method: ProviderName) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
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
        <PaymentMethodChoice
          methods={methods}
          chosenMethod={chosenMethod}
          total={total}
          onPick={onPickMethod}
        />
      )}

      {orderError && <p className="error">{orderError}</p>}
    </form>
  )
}

/**
 * Creates the order and goes to its payment page. Lives with the drawer, not
 * the form, because the submit button is in the footer.
 *
 * `submitting` is cleared however the attempt ends. The drawer stays mounted
 * after a successful order (it only hides), and the cart is deliberately not
 * emptied at checkout, so a reopened drawer must offer the button again.
 */
function useCreateOrder(onLeave: () => void) {
  const posthog = usePostHog()
  const router = useRouter()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
    chosenMethod: ProviderName,
  ) {
    event.preventDefault()
    if (submitting) return
    setOrderError(null)
    setSubmitting(true)

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

      posthog?.capture('checkout_started', {
        payment_method: result.provider,
        total: result.total,
      })
      onLeave()
      await navigate({
        to: '/checkout/payment/$orderNo',
        params: { orderNo: result.orderNo },
        // The cookie normally carries this; the query parameter keeps the link
        // usable if it was dropped or the page is opened elsewhere.
        search: { t: result.token },
      })

      await router.invalidate()
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Захиалга үүсгэхэд алдаа гарлаа')
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, orderError, submit }
}

function PaymentMethodChoice({
  methods,
  chosenMethod,
  total,
  onPick,
}: {
  methods: ProviderName[]
  chosenMethod: ProviderName
  total: number
  onPick: (method: ProviderName) => void
}) {
  const posthog = usePostHog()

  return (
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
                onChange={() => {
                  onPick(option)
                  posthog?.capture('payment_method_selected', {
                    payment_method: option,
                  })
                }}
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
  )
}

/**
 * Subtotal, shipping and the grand total, with the button that submits the
 * checkout form. `shipping` is null until the rates have loaded.
 */
function CartTotals({
  subtotal,
  shipping,
  submitting,
}: {
  subtotal: number
  shipping: number | null
  submitting: boolean
}) {
  return (
    <footer className="drawer__foot">
      <div className="totals__row">
        <span>Дүн</span>
        <strong>{formatMnt(subtotal)}</strong>
      </div>
      <div className="totals__row">
        <span>Хүргэлт</span>
        <strong>
          {shipping === null ? '…' : shipping === 0 ? 'Үнэгүй' : formatMnt(shipping)}
        </strong>
      </div>
      <div className="totals__row totals__row--grand">
        <span>Нийт</span>
        <strong>{formatMnt(subtotal + (shipping ?? 0))}</strong>
      </div>
      <button
        type="submit"
        form="drawer-checkout-form"
        className="btn"
        disabled={submitting}
      >
        {submitting ? 'Түр хүлээнэ үү…' : 'Төлбөр төлөх'}
      </button>
    </footer>
  )
}

/**
 * "Эрэлттэй бүтээгдэхүүн" under an empty cart: a few bestsellers, each with a
 * + that adds one straight to the cart without leaving the drawer.
 *
 * Owns its own busy and error state, so a failed add shows here and never
 * touches checkout. `onAdded` gets the cart the server answered with;
 * `onLeave` runs when a tap goes to the product page, to close the drawer.
 */
function CartSuggestions({
  suggestions,
  onAdded,
  onLeave,
}: {
  suggestions: CartSuggestion[]
  onAdded: (cart: CartView) => void
  onLeave: () => void
}) {
  const posthog = usePostHog()
  const router = useRouter()
  /** The variant a + tap is adding, so only that button shows it is busy. */
  const [adding, setAdding] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  async function add(item: CartSuggestion) {
    assert(adding === null, 'one suggestion is added at a time')
    setAddError(null)
    setAdding(item.variantId)
    try {
      const next = await addToCart({ data: { variantId: item.variantId, qty: 1 } })
      onAdded(next)
      posthog?.capture('product_added_to_cart', {
        product_slug: item.slug,
        quantity: 1,
        unit_price: item.price,
        variant_id: item.variantId,
        source: 'cart_suggestion',
      })
      // Keeps the header count in step.
      await router.invalidate()
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Нэмэхэд алдаа гарлаа')
    } finally {
      setAdding(null)
    }
  }

  return (
    <section className="suggest" aria-labelledby="suggest-title">
      <h3 id="suggest-title" className="suggest__title">
        Эрэлттэй бүтээгдэхүүн
      </h3>
      {addError && <p className="error">{addError}</p>}
      <ul className="suggest__list">
        {suggestions.map((item) => (
          <SuggestionItem
            key={item.variantId}
            item={item}
            adding={adding}
            onAdd={() => void add(item)}
            onLeave={onLeave}
          />
        ))}
      </ul>
    </section>
  )
}

/** One suggestion. `adding` is the variant in flight, if any, from any row. */
function SuggestionItem({
  item,
  adding,
  onAdd,
  onLeave,
}: {
  item: CartSuggestion
  adding: string | null
  onAdd: () => void
  onLeave: () => void
}) {
  const name = `${item.name}${sizeSuffix(item.name, item.size)}`
  return (
    <li className="suggest__item">
      <Link
        to="/products/$slug"
        params={{ slug: item.slug }}
        className="suggest__media"
        onClick={onLeave}
        tabIndex={-1}
        aria-hidden
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" />
        ) : (
          <span className="card__ph">{item.name}</span>
        )}
      </Link>
      <div className="suggest__body">
        <Link
          to="/products/$slug"
          params={{ slug: item.slug }}
          className="suggest__name"
          onClick={onLeave}
        >
          {name}
        </Link>
        <p className="suggest__price">{formatMnt(item.price)}</p>
      </div>
      <button
        type="button"
        className="suggest__add"
        aria-label={`${name} сагсанд нэмэх`}
        aria-busy={adding === item.variantId}
        disabled={adding !== null}
        onClick={onAdd}
      >
        {adding === item.variantId ? <Spinner /> : <PlusIcon />}
      </button>
    </li>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="square"
      />
    </svg>
  )
}

/** A quarter-arc that spins while a + tap is in flight. */
function Spinner() {
  return (
    <svg className="suggest__spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="square"
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
