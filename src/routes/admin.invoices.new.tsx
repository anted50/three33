import { useMemo, useState } from 'react'
import { usePostHog } from '@posthog/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Numpad } from '~/components/admin-numpad'
import { DEFAULT_CUSTOM_LINE_NAME } from '~/lib/server/admin/invoice-lines'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import {
  meetsMinimum,
  type InvoiceMethod,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LOGOS,
  PAYMENT_METHOD_MIN_TOTAL,
} from '~/lib/payment-methods'
import {
  createAdminInvoice,
  getInvoiceMethods,
  getVariants,
} from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/invoices/new')({
  loader: async () => {
    const [variants, methods] = await Promise.all([
      getVariants(),
      getInvoiceMethods(),
    ])
    return { variants, methods }
  },
  component: NewInvoice,
})

/** Form state keeps numbers as typed strings; they're parsed on submit. */
type Line =
  | { key: string; kind: 'variant'; variantId: string; qty: string; price: string }
  | { key: string; kind: 'custom'; name: string; qty: string; price: string }

let nextKey = 0
const newKey = () => `line-${nextKey++}`

/** Whole tugrik typed by the admin → mungu, or null if it isn't a valid amount. */
function parseTugrik(value: string): number | null {
  const n = Number(value.replace(/[\s,]/g, ''))
  return Number.isInteger(n) && n >= 0 ? tugrikToMungu(n) : null
}

function parseQty(value: string): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * Invoice maker, laid out like a till: the catalog and a numpad on the left
 * add lines to the invoice on the right. Any mix of catalog items (stock comes
 * off when it's paid) and free-form lines at any amount, sent to QPay or
 * StorePay.
 */
function NewInvoice() {
  const { variants, methods } = Route.useLoaderData()
  const posthog = usePostHog()
  const navigate = useNavigate()

  const [lines, setLines] = useState<Line[]>([])
  const [method, setMethod] = useState<InvoiceMethod>(methods[0] ?? 'qpay')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'items' | 'custom'>('items')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])

  /** Units of each variant already on the invoice, for the catalog's badges. */
  const inCart = new Map<string, number>()
  for (const line of lines) {
    if (line.kind === 'variant') {
      inCart.set(line.variantId, (inCart.get(line.variantId) ?? 0) + (parseQty(line.qty) ?? 0))
    }
  }

  const needle = query.trim().toLowerCase()
  const matches = variants
    .filter(
      (variant) =>
        needle === '' ||
        variant.productName.toLowerCase().includes(needle) ||
        variant.sku.toLowerCase().includes(needle) ||
        (variant.size ?? '').toLowerCase().includes(needle),
    )
    // Sold-out stays visible, so it's clear why it can't be added — just last.
    .sort((a, b) => Number(b.stockQty > 0) - Number(a.stockQty > 0))

  const total = lines.reduce((sum, line) => {
    const qty = parseQty(line.qty)
    const price = parseTugrik(line.price)
    return qty && price !== null ? sum + qty * price : sum
  }, 0)

  const units = lines.reduce((sum, line) => sum + (parseQty(line.qty) ?? 0), 0)

  const allowed = meetsMinimum(method, total)
  const min = PAYMENT_METHOD_MIN_TOTAL[method]

  function patch(key: string, value: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? ({ ...line, ...value } as Line) : line)),
    )
  }

  function remove(key: string) {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  /** Tapping an item again bumps its qty instead of adding a second row. */
  function addVariant(id: string) {
    const variant = byId.get(id)
    if (!variant || variant.stockQty <= 0) return
    setLines((current) => {
      const existing = current.find((l) => l.kind === 'variant' && l.variantId === id)
      if (existing) {
        const qty = Math.min((parseQty(existing.qty) ?? 0) + 1, variant.stockQty)
        return current.map((l) => (l === existing ? { ...l, qty: String(qty) } : l))
      }
      return [
        ...current,
        {
          key: newKey(),
          kind: 'variant',
          variantId: id,
          qty: '1',
          price: String(munguToTugrik(variant.price)),
        },
      ]
    })
  }

  function step(line: Line, delta: number) {
    const max = line.kind === 'variant' ? (byId.get(line.variantId)?.stockQty ?? 0) : Infinity
    const qty = Math.min(Math.max((parseQty(line.qty) ?? 1) + delta, 1), max)
    patch(line.key, { qty: String(qty) })
  }

  /** Enter in the search adds the item when there's no doubt which one — an
      exact SKU (a barcode scanner types one and presses Enter) or a lone hit. */
  function addFromSearch() {
    const inStock = matches.filter((v) => v.stockQty > 0)
    const exact = inStock.find((v) => v.sku.toLowerCase() === needle)
    const pick = exact ?? (inStock.length === 1 ? inStock[0] : undefined)
    if (!pick) return
    addVariant(pick.id)
    setQuery('')
  }

  async function submit() {
    setError(null)

    try {
      const payload = lines.map((line, index) => {
        const qty = parseQty(line.qty)
        const price = parseTugrik(line.price)
        const row = index + 1
        if (!qty) throw new Error(`${row}-р мөр: тоо ширхэг буруу байна`)
        if (price === null) throw new Error(`${row}-р мөр: үнэ буруу байна`)

        if (line.kind === 'variant') {
          const stock = byId.get(line.variantId)?.stockQty ?? 0
          if (qty > stock) throw new Error(`${row}-р мөр: нөөцөд ${stock} ширхэг байна`)
          return { kind: 'variant' as const, variantId: line.variantId, qty, unitPrice: price }
        }
        // Blank is fine: the server names it DEFAULT_CUSTOM_LINE_NAME.
        return {
          kind: 'custom' as const,
          name: line.name.trim() || undefined,
          qty,
          unitPrice: price,
        }
      })

      if (payload.length === 0) throw new Error('Дор хаяж нэг мөр нэмнэ үү')
      if (total <= 0) throw new Error('Нийт дүн 0-ээс их байх ёстой')

      setBusy(true)
      const { orderNo } = await createAdminInvoice({
        data: {
          method,
          phone: phone.trim(),
          email: email.trim(),
          name: name.trim() || undefined,
          note: note.trim() || undefined,
          lines: payload,
        },
      })
      posthog?.capture('admin_invoice_created', {
        line_count: payload.length,
        payment_method: method,
        total,
        unit_count: units,
      })
      await navigate({ to: '/admin/invoices/$orderNo', params: { orderNo } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нэхэмжлэх үүсгэж чадсангүй')
      setBusy(false)
    }
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <p className="adm__muted">
            <Link to="/admin/invoices">Нэхэмжлэх</Link> ›
          </p>
          <h1>Шинэ нэхэмжлэх</h1>
        </div>
      </header>

      <div className="inv">
        {/* ------------------------------------------------ add lines */}
        <section className="adm__card inv__add">
          <div className="inv__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'items'}
              className="inv__tab"
              onClick={() => setTab('items')}
            >
              Бараа
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'custom'}
              className="inv__tab"
              onClick={() => setTab('custom')}
            >
              Дурын дүн
            </button>
          </div>

          {tab === 'items' ? (
            <div role="tabpanel">
              <div className="inv__search">
                <input
                  type="search"
                  value={query}
                  autoFocus
                  placeholder="Нэр, хэмжээ эсвэл SKU-гаар хайх…"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addFromSearch()
                  }}
                />
              </div>

              {matches.length === 0 ? (
                <p className="adm__muted adm__pad">«{query.trim()}» олдсонгүй.</p>
              ) : (
                <ul className="inv__list">
                  {matches.map((variant) => {
                    const count = inCart.get(variant.id) ?? 0
                    const soldOut = variant.stockQty <= 0
                    return (
                      <li key={variant.id}>
                        <button
                          type="button"
                          className="inv__item"
                          data-picked={count > 0}
                          disabled={soldOut || count >= variant.stockQty}
                          onClick={() => addVariant(variant.id)}
                        >
                          <span className="inv__itemname">
                            {variant.productName}
                            {variant.size && <em>{variant.size}</em>}
                          </span>
                          <span className="inv__itemmeta adm__mono">
                            {variant.sku} · {soldOut ? 'дууссан' : `нөөц ${variant.stockQty}`}
                          </span>
                          <span className="inv__itemprice adm__num">
                            {formatMnt(variant.price)}
                          </span>
                          <span className="inv__itemcount" aria-hidden={count === 0}>
                            {count > 0 ? `×${count}` : '+'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="adm__pad" role="tabpanel">
              <Numpad
                namePlaceholder={DEFAULT_CUSTOM_LINE_NAME}
                submitLabel="Нэмэх"
                captureKeys
                onSubmit={({ tugrik, name: lineName }) =>
                  setLines((current) => [
                    ...current,
                    {
                      key: newKey(),
                      kind: 'custom',
                      name: lineName,
                      qty: '1',
                      price: String(tugrik),
                    },
                  ])
                }
              />
            </div>
          )}
        </section>

        {/* ------------------------------------------------ the invoice */}
        <section className="adm__card inv__sheet">
          <div className="adm__cardhead">
            <h2>Мөрүүд</h2>
            {lines.length > 0 && (
              <button type="button" className="inv__clear" onClick={() => setLines([])}>
                Бүгдийг хасах
              </button>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="inv__empty">
              <p>Хоосон байна</p>
              <p className="adm__muted">Бараа сонгох эсвэл дурын дүн оруулж мөр нэмнэ үү.</p>
            </div>
          ) : (
            <ul className="inv__lines">
              {lines.map((line) => {
                const qty = parseQty(line.qty)
                const price = parseTugrik(line.price)
                const variant = line.kind === 'variant' ? byId.get(line.variantId) : null
                const max = variant ? variant.stockQty : Infinity

                return (
                  <li key={line.key} className="inv__line">
                    <div className="inv__linehead">
                      {line.kind === 'variant' ? (
                        <div className="inv__linename">
                          {variant?.productName}
                          {variant?.size ? ` · ${variant.size}` : ''}
                          <span className="adm__muted adm__mono">
                            {variant?.sku} · нөөц {variant?.stockQty ?? 0}
                          </span>
                        </div>
                      ) : (
                        <input
                          className="inv__nameinput"
                          value={line.name}
                          placeholder={DEFAULT_CUSTOM_LINE_NAME}
                          maxLength={200}
                          aria-label="Нэр"
                          onChange={(e) => patch(line.key, { name: e.target.value })}
                        />
                      )}
                      <button
                        type="button"
                        className="adm__iconbtn"
                        aria-label="Мөр хасах"
                        onClick={() => remove(line.key)}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="inv__linebody">
                      <div className="inv__stepper">
                        <button
                          type="button"
                          aria-label="Нэгээр хасах"
                          disabled={(qty ?? 1) <= 1}
                          onClick={() => step(line, -1)}
                        >
                          −
                        </button>
                        <input
                          value={line.qty}
                          inputMode="numeric"
                          aria-label="Тоо"
                          aria-invalid={!qty || qty > max}
                          onChange={(e) => patch(line.key, { qty: e.target.value })}
                        />
                        <button
                          type="button"
                          aria-label="Нэгээр нэмэх"
                          disabled={(qty ?? 0) >= max}
                          onClick={() => step(line, 1)}
                        >
                          +
                        </button>
                      </div>

                      <label className="inv__price">
                        <span className="adm__muted">×</span>
                        <input
                          value={line.price}
                          inputMode="numeric"
                          placeholder="0"
                          aria-label="Нэгж үнэ (₮)"
                          aria-invalid={price === null}
                          onChange={(e) => patch(line.key, { price: e.target.value })}
                        />
                        <span className="adm__muted">₮</span>
                      </label>

                      <strong className="inv__linetotal adm__num">
                        {qty && price !== null ? formatMnt(qty * price) : '—'}
                      </strong>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="adm__pad inv__details">
            {methods.length === 0 ? (
              <p className="error">Төлбөрийн хэлбэр тохируулагдаагүй байна.</p>
            ) : (
              <fieldset className="field field--method">
                <legend>Төлбөрийн хэлбэр</legend>
                <div className="method-options">
                  {methods.map((option) => (
                    <label
                      key={option}
                      className={`field__radio${method === option ? ' field__radio--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="invoice-method"
                        checked={method === option}
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
                  ))}
                </div>
              </fieldset>
            )}

            <div className="inv__fields">
              <label className="field">
                <span>Утас{method === 'storepay' ? ' *' : ''}</span>
                <input
                  value={phone}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="99112233"
                  onChange={(e) => setPhone(e.target.value)}
                />
                {method === 'storepay' && <small>StorePay нэхэмжлэх энэ дугаар руу очно.</small>}
              </label>

              <label className="field">
                <span>И-мэйл</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>

              <label className="field">
                <span>Нэр</span>
                <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="field">
                <span>Тэмдэглэл</span>
                <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="inv__foot">
            <div className="inv__total">
              <span>
                Нийт
                {units > 0 && <small className="adm__muted"> · {units} ширхэг</small>}
              </span>
              <strong className="adm__num">{formatMnt(total)}</strong>
            </div>
            {!allowed && min !== undefined && (
              <p className="adm__muted adm__hint">
                {PAYMENT_METHOD_LABELS[method]} {formatMnt(min)}-с дээш дүнд боломжтой.
              </p>
            )}
            {error && <p className="error">{error}</p>}

            <button
              type="button"
              className="btn"
              disabled={busy || lines.length === 0 || total <= 0 || !allowed || methods.length === 0}
              onClick={submit}
            >
              {busy
                ? 'Үүсгэж байна…'
                : method === 'manual'
                  ? 'Төлсөнөөр бүртгэх'
                  : 'Нэхэмжлэх үүсгэх'}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
