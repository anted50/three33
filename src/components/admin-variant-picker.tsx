import { useState } from 'react'
import { formatMnt, type Mungu } from '~/lib/money'

export interface PickableVariant {
  id: string
  sku: string
  size: string | null
  price: Mungu
  stockQty: number
  productName: string
}

/**
 * Multi-select over every variant in the shop, searchable by name, SKU or
 * size. Used by the stock-receipt page.
 */
export function VariantPicker({
  variants,
  chosen,
  onPick,
  onClose,
}: {
  variants: PickableVariant[]
  /** Already on the page's sheet: shown ticked, and not pickable twice. */
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

  function toggle(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((other) => other !== id),
    )
  }

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
              {matches.map((variant) => (
                <PickerRow
                  key={variant.id}
                  variant={variant}
                  already={chosen.includes(variant.id)}
                  selected={selected.includes(variant.id)}
                  onToggle={(checked) => toggle(variant.id, checked)}
                />
              ))}
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

function PickerRow({
  variant,
  already,
  selected,
  onToggle,
}: {
  variant: PickableVariant
  already: boolean
  selected: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={already || selected}
          disabled={already}
          onChange={(e) => onToggle(e.target.checked)}
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
}
