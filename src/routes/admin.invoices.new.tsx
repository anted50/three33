import { useMemo, useState } from 'react'
import { usePostHog } from '@posthog/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Numpad } from '~/components/admin-numpad'
import { assert } from '~/lib/assert'
import { DEFAULT_CUSTOM_LINE_NAME } from '~/lib/server/admin/invoice-lines'
import { formatMnt, munguToTugrik, tugrikToMungu, type Mungu } from '~/lib/money'
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

type Variant = Awaited<ReturnType<typeof getVariants>>[number]
type VariantsById = ReadonlyMap<string, Variant>

/** The invoice line limits createAdminInvoiceInput enforces, mirrored here so
    an out-of-range entry reads as invalid on its row instead of failing the
    whole request later. Together they also keep the running total, at most
    100 × 10,000 × 1,000,000,000 mungu, inside Number.MAX_SAFE_INTEGER. */
const LINE_QTY_MAX = 10_000
const UNIT_PRICE_TUGRIK_MAX = 10_000_000
const INVOICE_LINES_MAX = 100

const INVOICE_FULL_MESSAGE = `Нэг нэхэмжлэхэд ${INVOICE_LINES_MAX}-аас олон мөр оруулах боломжгүй`

let nextKey = 0
const newKey = () => `line-${nextKey++}`

/** Whole tugrik typed by the admin → mungu, or null if it isn't a valid amount. */
function parseTugrik(value: string): Mungu | null {
  const n = Number(value.replace(/[\s,]/g, ''))
  return Number.isInteger(n) && n >= 0 && n <= UNIT_PRICE_TUGRIK_MAX ? tugrikToMungu(n) : null
}

function parseQty(value: string): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= LINE_QTY_MAX ? n : null
}

/** The most a line may hold: what is in stock for a catalog item. */
function lineQtyMax(line: Line, byId: VariantsById): number {
  if (line.kind === 'variant') {
    return Math.min(byId.get(line.variantId)?.stockQty ?? 0, LINE_QTY_MAX)
  }
  return LINE_QTY_MAX
}

/** Sum of the lines that parse; a row still being typed counts as nothing. */
function linesTotal(lines: Line[]): Mungu {
  let total = 0
  for (const line of lines) {
    const qty = parseQty(line.qty)
    const price = parseTugrik(line.price)
    if (qty !== null && price !== null) total += qty * price
  }
  assert(Number.isSafeInteger(total), 'linesTotal: total is not a safe integer')
  return total
}

function linesUnits(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + (parseQty(line.qty) ?? 0), 0)
}

/** Units of each variant already on the invoice, for the catalog's badges. */
function unitsByVariant(lines: Line[]): Map<string, number> {
  const units = new Map<string, number>()
  for (const line of lines) {
    if (line.kind === 'variant') {
      units.set(line.variantId, (units.get(line.variantId) ?? 0) + (parseQty(line.qty) ?? 0))
    }
  }
  return units
}

function matchVariants(variants: Variant[], needle: string): Variant[] {
  return variants
    .filter(
      (variant) =>
        needle === '' ||
        variant.productName.toLowerCase().includes(needle) ||
        variant.sku.toLowerCase().includes(needle) ||
        (variant.size ?? '').toLowerCase().includes(needle),
    )
    // Sold-out stays visible, so it's clear why it can't be added — just last.
    .sort((a, b) => Number(b.stockQty > 0) - Number(a.stockQty > 0))
}

/** Tapping an item again bumps its qty instead of adding a second row. */
function withVariantAdded(current: Line[], variant: Variant): Line[] {
  assert(variant.stockQty > 0, 'withVariantAdded: variant is sold out')
  const existing = current.find((l) => l.kind === 'variant' && l.variantId === variant.id)
  if (existing) {
    const qty = Math.min((parseQty(existing.qty) ?? 0) + 1, variant.stockQty, LINE_QTY_MAX)
    return current.map((l) => (l === existing ? { ...l, qty: String(qty) } : l))
  }
  // A full invoice takes no new rows; the sheet says why.
  if (current.length >= INVOICE_LINES_MAX) return current
  return [
    ...current,
    {
      key: newKey(),
      kind: 'variant',
      variantId: variant.id,
      qty: '1',
      price: String(munguToTugrik(variant.price)),
    },
  ]
}

/**
 * The rows as createAdminInvoice takes them. Throws, with the row number, at
 * the first row that would not pass — the message is shown to the admin.
 */
function invoiceLinesPayload(lines: Line[], byId: VariantsById) {
  assert(lines.length <= INVOICE_LINES_MAX, 'invoiceLinesPayload: more rows than an invoice holds')
  return lines.map((line, index) => {
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
}

/** The invoice's rows and every way the page edits them. */
function useInvoiceLines(byId: VariantsById) {
  const [lines, setLines] = useState<Line[]>([])

  function addVariant(id: string) {
    const variant = byId.get(id)
    if (!variant || variant.stockQty <= 0) return
    setLines((current) => withVariantAdded(current, variant))
  }

  function addCustom({ tugrik, name }: { tugrik: number; name: string }) {
    setLines((current) => {
      // A full invoice takes no new rows; the sheet says why.
      if (current.length >= INVOICE_LINES_MAX) return current
      return [...current, { key: newKey(), kind: 'custom', name, qty: '1', price: String(tugrik) }]
    })
  }

  function patch(key: string, value: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? ({ ...line, ...value } as Line) : line)),
    )
  }

  function remove(key: string) {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  function step(line: Line, delta: number) {
    const qty = Math.min(Math.max((parseQty(line.qty) ?? 1) + delta, 1), lineQtyMax(line, byId))
    patch(line.key, { qty: String(qty) })
  }

  function clear() {
    setLines([])
  }

  return { lines, addVariant, addCustom, patch, remove, step, clear }
}

type LineEditor = ReturnType<typeof useInvoiceLines>

/**
 * Invoice maker, laid out like a till: the catalog and a numpad on the left
 * add lines to the invoice on the right. Any mix of catalog items (stock comes
 * off when it's paid) and free-form lines at any amount, sent to QPay or
 * StorePay.
 */
function NewInvoice() {
  const { variants, methods } = Route.useLoaderData()
  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])
  const editor = useInvoiceLines(byId)

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
        <AddLines variants={variants} editor={editor} />
        <InvoiceSheet methods={methods} byId={byId} editor={editor} />
      </div>
    </>
  )
}

/* ------------------------------------------------ add lines */

function AddLines({ variants, editor }: { variants: Variant[]; editor: LineEditor }) {
  const [tab, setTab] = useState<'items' | 'custom'>('items')
  // Kept here, not in the catalog panel, so the search survives a tab switch.
  const [query, setQuery] = useState('')

  return (
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
        <Catalog variants={variants} query={query} onQueryChange={setQuery} editor={editor} />
      ) : (
        <div className="adm__pad" role="tabpanel">
          <Numpad
            namePlaceholder={DEFAULT_CUSTOM_LINE_NAME}
            submitLabel="Нэмэх"
            captureKeys
            onSubmit={editor.addCustom}
          />
        </div>
      )}
    </section>
  )
}

function Catalog({
  variants,
  query,
  onQueryChange,
  editor,
}: {
  variants: Variant[]
  query: string
  onQueryChange: (query: string) => void
  editor: LineEditor
}) {
  const needle = query.trim().toLowerCase()
  const matches = matchVariants(variants, needle)
  const inCart = unitsByVariant(editor.lines)

  /** Enter in the search adds the item when there's no doubt which one — an
      exact SKU (a barcode scanner types one and presses Enter) or a lone hit. */
  function addFromSearch() {
    const inStock = matches.filter((v) => v.stockQty > 0)
    const exact = inStock.find((v) => v.sku.toLowerCase() === needle)
    const pick = exact ?? (inStock.length === 1 ? inStock[0] : undefined)
    if (!pick) return
    editor.addVariant(pick.id)
    onQueryChange('')
  }

  return (
    <div role="tabpanel">
      <div className="inv__search">
        <input
          type="search"
          value={query}
          autoFocus
          placeholder="Нэр, хэмжээ эсвэл SKU-гаар хайх…"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addFromSearch()
          }}
        />
      </div>

      {matches.length === 0 ? (
        <p className="adm__muted adm__pad">«{query.trim()}» олдсонгүй.</p>
      ) : (
        <ul className="inv__list">
          {matches.map((variant) => (
            <li key={variant.id}>
              <CatalogItem
                variant={variant}
                count={inCart.get(variant.id) ?? 0}
                onAdd={() => editor.addVariant(variant.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CatalogItem({
  variant,
  count,
  onAdd,
}: {
  variant: Variant
  count: number
  onAdd: () => void
}) {
  const soldOut = variant.stockQty <= 0

  return (
    <button
      type="button"
      className="inv__item"
      data-picked={count > 0}
      disabled={soldOut || count >= variant.stockQty}
      onClick={onAdd}
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
  )
}

/* ------------------------------------------------ the invoice */

interface Contact {
  phone: string
  email: string
  name: string
  note: string
}

function InvoiceSheet({
  methods,
  byId,
  editor,
}: {
  methods: InvoiceMethod[]
  byId: VariantsById
  editor: LineEditor
}) {
  const posthog = usePostHog()
  const navigate = useNavigate()
  const [method, setMethod] = useState<InvoiceMethod>(methods[0] ?? 'qpay')
  const [contact, setContact] = useState<Contact>({ phone: '', email: '', name: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { lines } = editor
  const total = linesTotal(lines)
  const units = linesUnits(lines)
  const allowed = meetsMinimum(method, total)

  async function submit() {
    setError(null)

    try {
      const payload = invoiceLinesPayload(lines, byId)
      if (payload.length === 0) throw new Error('Дор хаяж нэг мөр нэмнэ үү')
      if (total <= 0) throw new Error('Нийт дүн 0-ээс их байх ёстой')

      setBusy(true)
      const { orderNo } = await createAdminInvoice({
        data: {
          method,
          phone: contact.phone.trim(),
          email: contact.email.trim(),
          name: contact.name.trim() || undefined,
          note: contact.note.trim() || undefined,
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
    <section className="adm__card inv__sheet">
      <div className="adm__cardhead">
        <h2>Мөрүүд</h2>
        {lines.length > 0 && (
          <button type="button" className="inv__clear" onClick={editor.clear}>
            Бүгдийг хасах
          </button>
        )}
      </div>

      <SheetLines byId={byId} editor={editor} />

      <div className="adm__pad inv__details">
        <MethodPicker methods={methods} method={method} onChange={setMethod} />
        <ContactFields contact={contact} method={method} onChange={setContact} />
      </div>

      <div className="inv__foot">
        <div className="inv__total">
          <span>
            Нийт
            {units > 0 && <small className="adm__muted"> · {units} ширхэг</small>}
          </span>
          <strong className="adm__num">{formatMnt(total)}</strong>
        </div>
        <MinimumHint method={method} allowed={allowed} />
        {lines.length >= INVOICE_LINES_MAX && (
          <p className="adm__muted adm__hint">{INVOICE_FULL_MESSAGE}</p>
        )}
        {error && <p className="error">{error}</p>}

        <button
          type="button"
          className="btn"
          disabled={busy || lines.length === 0 || total <= 0 || !allowed || methods.length === 0}
          onClick={submit}
        >
          {submitLabel(busy, method)}
        </button>
      </div>
    </section>
  )
}

function submitLabel(busy: boolean, method: InvoiceMethod): string {
  if (busy) return 'Үүсгэж байна…'
  if (method === 'manual') return 'Төлсөнөөр бүртгэх'
  return 'Нэхэмжлэх үүсгэх'
}

function MinimumHint({ method, allowed }: { method: InvoiceMethod; allowed: boolean }) {
  const min = PAYMENT_METHOD_MIN_TOTAL[method]
  if (allowed || min === undefined) return null

  return (
    <p className="adm__muted adm__hint">
      {PAYMENT_METHOD_LABELS[method]} {formatMnt(min)}-с дээш дүнд боломжтой.
    </p>
  )
}

function SheetLines({ byId, editor }: { byId: VariantsById; editor: LineEditor }) {
  if (editor.lines.length === 0) {
    return (
      <div className="inv__empty">
        <p>Хоосон байна</p>
        <p className="adm__muted">Бараа сонгох эсвэл дурын дүн оруулж мөр нэмнэ үү.</p>
      </div>
    )
  }

  return (
    <ul className="inv__lines">
      {editor.lines.map((line) => (
        <SheetLine key={line.key} line={line} byId={byId} editor={editor} />
      ))}
    </ul>
  )
}

function SheetLine({ line, byId, editor }: { line: Line; byId: VariantsById; editor: LineEditor }) {
  const qty = parseQty(line.qty)
  const price = parseTugrik(line.price)

  return (
    <li className="inv__line">
      <div className="inv__linehead">
        {line.kind === 'variant' ? (
          <VariantLineName variant={byId.get(line.variantId)} />
        ) : (
          <input
            className="inv__nameinput"
            value={line.name}
            placeholder={DEFAULT_CUSTOM_LINE_NAME}
            maxLength={200}
            aria-label="Нэр"
            onChange={(e) => editor.patch(line.key, { name: e.target.value })}
          />
        )}
        <button
          type="button"
          className="adm__iconbtn"
          aria-label="Мөр хасах"
          onClick={() => editor.remove(line.key)}
        >
          ✕
        </button>
      </div>

      <div className="inv__linebody">
        <QtyStepper line={line} max={lineQtyMax(line, byId)} editor={editor} />

        <label className="inv__price">
          <span className="adm__muted">×</span>
          <input
            value={line.price}
            inputMode="numeric"
            placeholder="0"
            aria-label="Нэгж үнэ (₮)"
            aria-invalid={price === null}
            onChange={(e) => editor.patch(line.key, { price: e.target.value })}
          />
          <span className="adm__muted">₮</span>
        </label>

        <strong className="inv__linetotal adm__num">
          {qty && price !== null ? formatMnt(qty * price) : '—'}
        </strong>
      </div>
    </li>
  )
}

function QtyStepper({ line, max, editor }: { line: Line; max: number; editor: LineEditor }) {
  const qty = parseQty(line.qty)

  return (
    <div className="inv__stepper">
      <button
        type="button"
        aria-label="Нэгээр хасах"
        disabled={(qty ?? 1) <= 1}
        onClick={() => editor.step(line, -1)}
      >
        −
      </button>
      <input
        value={line.qty}
        inputMode="numeric"
        aria-label="Тоо"
        aria-invalid={!qty || qty > max}
        onChange={(e) => editor.patch(line.key, { qty: e.target.value })}
      />
      <button
        type="button"
        aria-label="Нэгээр нэмэх"
        disabled={(qty ?? 0) >= max}
        onClick={() => editor.step(line, 1)}
      >
        +
      </button>
    </div>
  )
}

/** A catalog line's name; the variant is missing only if it was deleted meanwhile. */
function VariantLineName({ variant }: { variant: Variant | undefined }) {
  return (
    <div className="inv__linename">
      {variant?.productName}
      {variant?.size ? ` · ${variant.size}` : ''}
      <span className="adm__muted adm__mono">
        {variant?.sku} · нөөц {variant?.stockQty ?? 0}
      </span>
    </div>
  )
}

function MethodPicker({
  methods,
  method,
  onChange,
}: {
  methods: InvoiceMethod[]
  method: InvoiceMethod
  onChange: (method: InvoiceMethod) => void
}) {
  if (methods.length === 0) {
    return <p className="error">Төлбөрийн хэлбэр тохируулагдаагүй байна.</p>
  }

  return (
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
              onChange={() => onChange(option)}
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
  )
}

function ContactFields({
  contact,
  method,
  onChange,
}: {
  contact: Contact
  method: InvoiceMethod
  onChange: (update: (current: Contact) => Contact) => void
}) {
  function set(field: keyof Contact, value: string) {
    onChange((current) => ({ ...current, [field]: value }))
  }

  return (
    <div className="inv__fields">
      <label className="field">
        <span>Утас{method === 'storepay' ? ' *' : ''}</span>
        <input
          value={contact.phone}
          inputMode="numeric"
          maxLength={8}
          placeholder="99112233"
          onChange={(e) => set('phone', e.target.value)}
        />
        {method === 'storepay' && <small>StorePay нэхэмжлэх энэ дугаар руу очно.</small>}
      </label>

      <label className="field">
        <span>И-мэйл</span>
        <input type="email" value={contact.email} onChange={(e) => set('email', e.target.value)} />
      </label>

      <label className="field">
        <span>Нэр</span>
        <input value={contact.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
      </label>

      <label className="field">
        <span>Тэмдэглэл</span>
        <input value={contact.note} maxLength={500} onChange={(e) => set('note', e.target.value)} />
      </label>
    </div>
  )
}
