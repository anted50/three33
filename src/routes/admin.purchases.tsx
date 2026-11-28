import { useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { VariantPicker } from '~/components/admin-variant-picker'
import { assert } from '~/lib/assert'
import { formatMnt, munguToTugrik, tugrikToMungu, type Mungu } from '~/lib/money'
import { getVariants, receiveStock } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/purchases')({
  loader: () => getVariants(),
  component: Purchases,
})

interface Line {
  variantId: string
  /** Units arriving. */
  qty: string
  /** Selling price in tugrik, prefilled with the current one. */
  price: string
}

type Variant = Awaited<ReturnType<typeof getVariants>>[number]
type VariantsById = ReadonlyMap<string, Variant>

/** The limits receiveStockInput enforces, mirrored so a bad row is caught here. */
const RECEIVE_LINES_MAX = 200
const ARRIVING_QTY_MAX = 1_000_000
const PRICE_TUGRIK_MAX = 10_000_000

/** Units arriving: a whole number, 0 meaning "only correct the price". */
function parseArrivingQty(value: string): number | null {
  const qty = Number(value)
  return Number.isInteger(qty) && qty >= 0 && qty <= ARRIVING_QTY_MAX ? qty : null
}

/**
 * The new selling price, tugrik typed → mungu. Blank is invalid rather than
 * zero: clearing the field and saving would otherwise put the item on sale
 * for nothing.
 */
function parsePrice(value: string): Mungu | null {
  if (value.trim() === '') return null
  const tugrik = Number(value)
  if (!Number.isFinite(tugrik)) return null
  if (tugrik < 0) return null
  if (tugrik > PRICE_TUGRIK_MAX) return null
  return tugrikToMungu(tugrik)
}

/**
 * The value of what arrived, at the new prices. Rows still being typed count
 * as nothing. Each row is at most 10^6 × 10^9 mungu, so a whole sheet can pass
 * Number.MAX_SAFE_INTEGER; null says the sum is too big to show.
 */
function receivedTotal(lines: Line[]): Mungu | null {
  let total = 0
  for (const line of lines) {
    const qty = parseArrivingQty(line.qty)
    const price = parsePrice(line.price)
    if (qty !== null && price !== null) total += price * qty
  }
  return Number.isSafeInteger(total) ? total : null
}

/** The rows as receiveStock takes them. Throws at the first bad row, by SKU. */
function receiveStockPayload(lines: Line[], byId: VariantsById) {
  if (lines.length > RECEIVE_LINES_MAX) {
    throw new Error(`Нэг удаад ${RECEIVE_LINES_MAX}-аас олон мөр бүртгэх боломжгүй`)
  }
  return lines.map((line) => {
    const qty = parseArrivingQty(line.qty)
    const price = parsePrice(line.price)
    const sku = byId.get(line.variantId)?.sku

    if (qty === null) throw new Error(`${sku}: тоо ширхэг буруу байна`)
    if (price === null) throw new Error(`${sku}: үнэ буруу байна`)

    return { variantId: line.variantId, qty, price }
  })
}

/**
 * Goods-received note: pick the variants a delivery contained, type how many
 * arrived and what they now sell for, save once. The alternative was opening
 * each product page in turn, which is where miscounts come from.
 */
function Purchases() {
  const variants = Route.useLoaderData()
  const router = useRouter()
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  const byId = useMemo(
    () => new Map(variants.map((v) => [v.id, v])),
    [variants],
  )
  const { lines, addVariants, patch, remove, clear } = useReceiveLines(byId)

  async function save() {
    setError(null)
    setSaved(null)
    setBusy(true)
    try {
      const payload = receiveStockPayload(lines, byId)
      const result = await receiveStock({ data: { lines: payload } })
      setSaved(result.lines)
      clear()
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Бүртгэхэд алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PurchasesHeader onPick={() => setPicking(true)} />

      {error && <p className="error">{error}</p>}
      {saved !== null && (
        <p className="adm__muted">{saved} мөр амжилттай бүртгэгдлээ.</p>
      )}

      <section className="adm__card">
        {lines.length === 0 ? (
          <p className="adm__muted adm__pad">
            Бараа сонгоогүй байна. «Бараа сонгох» дарж эхэлнэ үү.
          </p>
        ) : (
          <ReceiveTable lines={lines} byId={byId} onPatch={patch} onRemove={remove} />
        )}
      </section>

      {lines.length > 0 && (
        <ReceiveSummary lines={lines} busy={busy} onSave={save} />
      )}

      {picking && (
        <VariantPicker
          variants={variants}
          chosen={lines.map((line) => line.variantId)}
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

function PurchasesHeader({ onPick }: { onPick: () => void }) {
  return (
    <header className="adm__head">
      <div>
        <h1>Татан авалт</h1>
      </div>
      <button type="button" className="btn btn--sm" onClick={onPick}>
        + Бараа сонгох
      </button>
    </header>
  )
}

/** The sheet's rows, one per variant, and every way the page edits them. */
function useReceiveLines(byId: VariantsById) {
  const [lines, setLines] = useState<Line[]>([])

  function addVariants(ids: string[]) {
    setLines((current) => [
      ...current,
      ...ids
        .filter((id) => !current.some((line) => line.variantId === id))
        .map((id) => {
          const variant = byId.get(id)
          assert(variant, `addVariants: picked an unknown variant ${id}`)
          return { variantId: id, qty: '1', price: String(munguToTugrik(variant.price)) }
        }),
    ])
  }

  function patch(variantId: string, patchValue: Partial<Line>) {
    setLines((current) =>
      current.map((line) =>
        line.variantId === variantId ? { ...line, ...patchValue } : line,
      ),
    )
  }

  function remove(variantId: string) {
    setLines((current) => current.filter((line) => line.variantId !== variantId))
  }

  function clear() {
    setLines([])
  }

  return { lines, addVariants, patch, remove, clear }
}

function ReceiveTable({
  lines,
  byId,
  onPatch,
  onRemove,
}: {
  lines: Line[]
  byId: VariantsById
  onPatch: (variantId: string, patchValue: Partial<Line>) => void
  onRemove: (variantId: string) => void
}) {
  return (
    <table className="adm__table adm__table--form">
      <thead>
        <tr>
          <th>Бараа</th>
          <th>SKU</th>
          <th>Одоогийн нөөц</th>
          <th>Ирсэн тоо</th>
          <th>Шинэ үнэ (₮)</th>
          <th>Болох нөөц</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          // Missing only if the variant was deleted since it was picked.
          const variant = byId.get(line.variantId)
          if (!variant) return null
          return (
            <ReceiveRow
              key={line.variantId}
              line={line}
              variant={variant}
              onPatch={onPatch}
              onRemove={onRemove}
            />
          )
        })}
      </tbody>
    </table>
  )
}

function ReceiveRow({
  line,
  variant,
  onPatch,
  onRemove,
}: {
  line: Line
  variant: Variant
  onPatch: (variantId: string, patchValue: Partial<Line>) => void
  onRemove: (variantId: string) => void
}) {
  const nextStock = variant.stockQty + (parseArrivingQty(line.qty) ?? 0)

  return (
    <tr>
      <td>
        {variant.productName}
        {variant.size ? ` · ${variant.size}` : ''}
      </td>
      <td className="adm__mono">{variant.sku}</td>
      <td className="adm__num">{variant.stockQty}</td>
      <td>
        <input
          value={line.qty}
          inputMode="numeric"
          size={5}
          onChange={(e) => onPatch(line.variantId, { qty: e.target.value })}
        />
      </td>
      <td>
        <input
          value={line.price}
          inputMode="numeric"
          size={8}
          onChange={(e) => onPatch(line.variantId, { price: e.target.value })}
        />
      </td>
      <td className="adm__num">{nextStock}</td>
      <td>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => onRemove(line.variantId)}
        >
          Хасах
        </button>
      </td>
    </tr>
  )
}

function ReceiveSummary({
  lines,
  busy,
  onSave,
}: {
  lines: Line[]
  busy: boolean
  onSave: () => void
}) {
  const total = receivedTotal(lines)

  return (
    <section className="adm__card adm__pad">
      <div className="totals__row">
        <span>Нийт {lines.length} нэр төрөл</span>
        <strong>{total === null ? '—' : formatMnt(total)}</strong>
      </div>

      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={onSave}
      >
        {busy ? 'Бүртгэж байна…' : 'Татан авалт бүртгэх'}
      </button>
    </section>
  )
}
