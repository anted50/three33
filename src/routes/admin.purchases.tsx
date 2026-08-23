import { useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import { getVariants, receiveStock } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/purchases')({
  loader: () => getVariants(),
  component: Purchases,
})

type Variant = Awaited<ReturnType<typeof getVariants>>[number]

interface Line {
  variantId: string
  /** Units arriving. */
  qty: string
  /** Selling price in tugrik, prefilled with the current one. */
  price: string
}

/**
 * Goods-received note: pick the variants a delivery contained, type how many
 * arrived and what they now sell for, save once. The alternative was opening
 * each product page in turn, which is where miscounts come from.
 */
function Purchases() {
  const variants = Route.useLoaderData()
  const router = useRouter()
  const [lines, setLines] = useState<Line[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  const byId = useMemo(
    () => new Map(variants.map((v) => [v.id, v])),
    [variants],
  )

  const total = lines.reduce((sum, line) => {
    const qty = Number(line.qty)
    const price = Number(line.price)
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum
    return sum + tugrikToMungu(price) * qty
  }, 0)

  function addVariants(ids: string[]) {
    setLines((current) => [
      ...current,
      ...ids
        .filter((id) => !current.some((line) => line.variantId === id))
        .map((id) => ({
          variantId: id,
          qty: '1',
          price: String(munguToTugrik(byId.get(id)?.price ?? 0)),
        })),
    ])
  }

  function patch(variantId: string, patchValue: Partial<Line>) {
    setLines((current) =>
      current.map((line) =>
        line.variantId === variantId ? { ...line, ...patchValue } : line,
      ),
    )
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Татан авалт</h1>
          <p className="adm__muted">
            Ирсэн барааны тоо, шинэ үнийг нэг дор бүртгэнэ
          </p>
        </div>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setPicking(true)}
        >
          + Бараа сонгох
        </button>
      </header>

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
                const variant = byId.get(line.variantId)
                if (!variant) return null
                const qty = Number(line.qty)
                const nextStock =
                  variant.stockQty + (Number.isFinite(qty) ? qty : 0)

                return (
                  <tr key={line.variantId}>
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
                        onChange={(e) =>
                          patch(line.variantId, { qty: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={line.price}
                        inputMode="numeric"
                        size={8}
                        onChange={(e) =>
                          patch(line.variantId, { price: e.target.value })
                        }
                      />
                    </td>
                    <td className="adm__num">{nextStock}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() =>
                          setLines((current) =>
                            current.filter(
                              (other) => other.variantId !== line.variantId,
                            ),
                          )
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

      {lines.length > 0 && (
        <section className="adm__card adm__pad">
          <div className="totals__row">
            <span>Нийт {lines.length} нэр төрөл</span>
            <strong>{formatMnt(total)}</strong>
          </div>
          <p className="adm__muted adm__hint">
            Дүн нь зарах үнээр тооцсон урьдчилсан тооцоо.
          </p>

          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setError(null)
              setSaved(null)

              setBusy(true)
              try {
                const payload = lines.map((line) => {
                  const qty = Number(line.qty)
                  const price = Number(line.price)
                  const variant = byId.get(line.variantId)

                  if (!Number.isInteger(qty) || qty < 0) {
                    throw new Error(`${variant?.sku}: тоо ширхэг буруу байна`)
                  }
                  if (!Number.isFinite(price) || price < 0) {
                    throw new Error(`${variant?.sku}: үнэ буруу байна`)
                  }

                  return {
                    variantId: line.variantId,
                    qty,
                    price: tugrikToMungu(price),
                  }
                })

                const result = await receiveStock({ data: { lines: payload } })
                setSaved(result.lines)
                setLines([])
                await router.invalidate()
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : 'Бүртгэхэд алдаа гарлаа',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Бүртгэж байна…' : 'Татан авалт бүртгэх'}
          </button>
        </section>
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

function VariantPicker({
  variants,
  chosen,
  onPick,
  onClose,
}: {
  variants: Variant[]
  chosen: string[]
  onPick: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const needle = query.trim().toLowerCase()
  const matches = variants.filter(
    (variant) =>
      needle === '' ||
      variant.productName.toLowerCase().includes(needle) ||
      variant.sku.toLowerCase().includes(needle) ||
      (variant.size ?? '').toLowerCase().includes(needle),
  )

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__card">
        <div className="modal__head">
          <h2>Бараа сонгох</h2>
          <button type="button" className="modal__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <input
            className="modal__search"
            value={query}
            placeholder="Нэр эсвэл SKU-гаар хайх…"
            onChange={(e) => setQuery(e.target.value)}
          />

          <table className="adm__table">
            <thead>
              <tr>
                <th />
                <th>Бараа</th>
                <th>SKU</th>
                <th>Нөөц</th>
                <th>Үнэ</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((variant) => {
                const already = chosen.includes(variant.id)
                return (
                  <tr key={variant.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={already || selected.includes(variant.id)}
                        disabled={already}
                        onChange={(e) =>
                          setSelected((current) =>
                            e.target.checked
                              ? [...current, variant.id]
                              : current.filter((id) => id !== variant.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {variant.productName}
                      {variant.size ? ` · ${variant.size}` : ''}
                    </td>
                    <td className="adm__mono">{variant.sku}</td>
                    <td className="adm__num">{variant.stockQty}</td>
                    <td className="adm__num">{formatMnt(variant.price)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="modal__foot">
          <span className="adm__muted">{selected.length} сонгосон</span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={selected.length === 0}
            onClick={() => onPick(selected)}
          >
            Сонгох
          </button>
        </div>
      </div>
    </div>
  )
}
