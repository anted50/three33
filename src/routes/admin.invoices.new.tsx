import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { NumpadDialog } from '~/components/admin-numpad'
import { VariantPicker } from '~/components/admin-variant-picker'
import { DEFAULT_CUSTOM_LINE_NAME } from '~/lib/server/admin/invoice-lines'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import {
  meetsMinimum,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LOGOS,
  PAYMENT_METHOD_MIN_TOTAL,
} from '~/lib/payment-methods'
import {
  createAdminInvoice,
  getInvoiceMethods,
  getVariants,
} from '~/lib/server/admin/admin'
import type { ProviderName } from '~/lib/server/payments/registry'

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
 * Invoice maker: any mix of catalog items (stock comes off when it's paid)
 * and free-form lines at any amount, sent to QPay or StorePay.
 */
function NewInvoice() {
  const { variants, methods } = Route.useLoaderData()
  const navigate = useNavigate()

  const [lines, setLines] = useState<Line[]>([])
  const [method, setMethod] = useState<ProviderName>(methods[0] ?? 'qpay')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)
  /** Open numpad: `key` set when editing that custom line, absent when adding. */
  const [numpad, setNumpad] = useState<{ key?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])

  const total = lines.reduce((sum, line) => {
    const qty = parseQty(line.qty)
    const price = parseTugrik(line.price)
    return qty && price !== null ? sum + qty * price : sum
  }, 0)

  const editing = numpad?.key ? lines.find((l) => l.key === numpad.key) : undefined
  const editingLine = editing?.kind === 'custom' ? editing : undefined
  const editingPrice = editingLine ? parseTugrik(editingLine.price) : null

  const allowed = meetsMinimum(method, total)
  const min = PAYMENT_METHOD_MIN_TOTAL[method]

  function patch(key: string, value: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? ({ ...line, ...value } as Line) : line)),
    )
  }

  function addVariants(ids: string[]) {
    setLines((current) => [
      ...current,
      ...ids.map(
        (id): Line => ({
          key: newKey(),
          kind: 'variant',
          variantId: id,
          qty: '1',
          price: String(munguToTugrik(byId.get(id)?.price ?? 0)),
        }),
      ),
    ])
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

      {error && <p className="error">{error}</p>}

      <section className="adm__card">
        <div className="adm__cardhead">
          <h2>Мөрүүд</h2>
          <div className="adm__actions">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setPicking(true)}
            >
              + Бараа
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setNumpad({})}
            >
              + Дурын дүн
            </button>
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="adm__muted adm__pad">
            «Бараа» нэмбэл төлбөр төлөгдөх үед нөөцөөс хасагдана. «Дурын дүн» нь
            нөөцөд нөлөөлөхгүй — үйлчилгээ, хүргэлт гэх мэт.
          </p>
        ) : (
          <table className="adm__table adm__table--form">
            <thead>
              <tr>
                <th>Нэр</th>
                <th>Тоо</th>
                <th>Нэгж үнэ (₮)</th>
                <th>Дүн</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const qty = parseQty(line.qty)
                const price = parseTugrik(line.price)
                const variant = line.kind === 'variant' ? byId.get(line.variantId) : null

                return (
                  <tr key={line.key}>
                    <td>
                      {line.kind === 'variant' ? (
                        <>
                          {variant?.productName}
                          {variant?.size ? ` · ${variant.size}` : ''}
                          <br />
                          <span className="adm__muted adm__mono">
                            {variant?.sku} · нөөц {variant?.stockQty ?? 0}
                          </span>
                        </>
                      ) : (
                        <input
                          value={line.name}
                          placeholder={DEFAULT_CUSTOM_LINE_NAME}
                          maxLength={200}
                          onChange={(e) => patch(line.key, { name: e.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        value={line.qty}
                        inputMode="numeric"
                        size={4}
                        onChange={(e) => patch(line.key, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      {line.kind === 'custom' ? (
                        <button
                          type="button"
                          className="amount-cell"
                          onClick={() => setNumpad({ key: line.key })}
                        >
                          {price !== null ? formatMnt(price) : '—'}
                        </button>
                      ) : (
                        <input
                          value={line.price}
                          inputMode="numeric"
                          size={9}
                          placeholder="0"
                          onChange={(e) => patch(line.key, { price: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="adm__num">
                      {qty && price !== null ? formatMnt(qty * price) : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() =>
                          setLines((current) => current.filter((l) => l.key !== line.key))
                        }
                      >
                        Хасах
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="adm__card adm__pad">
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

        <label className="field">
          <span>Утас{method === 'storepay' ? ' *' : ''}</span>
          <input
            value={phone}
            inputMode="numeric"
            maxLength={8}
            placeholder="99112233"
            onChange={(e) => setPhone(e.target.value)}
          />
          <small>
            {method === 'storepay'
              ? 'StorePay нэхэмжлэх энэ дугаар руу очно.'
              : 'Заавал биш.'}
          </small>
        </label>

        <label className="field">
          <span>И-мэйл</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <small>Төлөгдсөний дараа баримт илгээнэ.</small>
        </label>

        <label className="field">
          <span>Нэр</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>Тэмдэглэл</span>
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="totals__row totals__row--grand">
          <span>Нийт</span>
          <strong>{formatMnt(total)}</strong>
        </div>
        {!allowed && min !== undefined && (
          <p className="adm__muted adm__hint">
            {PAYMENT_METHOD_LABELS[method]} {formatMnt(min)}-с дээш дүнд боломжтой.
          </p>
        )}

        <button
          type="button"
          className="btn"
          style={{ marginTop: 16 }}
          disabled={busy || lines.length === 0 || total <= 0 || !allowed || methods.length === 0}
          onClick={submit}
        >
          {busy ? 'Үүсгэж байна…' : 'Нэхэмжлэх үүсгэх'}
        </button>
      </section>

      {numpad && (
        <NumpadDialog
          initialTugrik={editingPrice !== null ? munguToTugrik(editingPrice) : 0}
          initialName={editingLine?.name ?? ''}
          namePlaceholder={DEFAULT_CUSTOM_LINE_NAME}
          submitLabel={numpad.key ? 'Хадгалах' : 'Нэмэх'}
          onClose={() => setNumpad(null)}
          onSubmit={({ tugrik, name: lineName }) => {
            if (numpad.key) {
              patch(numpad.key, { price: String(tugrik), name: lineName })
            } else {
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
            setNumpad(null)
          }}
        />
      )}

      {picking && (
        <VariantPicker
          variants={variants}
          chosen={lines.flatMap((l) => (l.kind === 'variant' ? [l.variantId] : []))}
          hideOutOfStock
          onClose={() => setPicking(false)}
          onPick={(ids) => {
            addVariants(ids)
            setPicking(false)
          }}
        />
      )}
    </>
  )
}
