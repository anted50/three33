import { useEffect, useState } from 'react'
import { formatMnt, tugrikToMungu } from '~/lib/money'

/** 10,000,000₮ — the invoice line's own unit-price ceiling, in tugrik. */
const MAX_TUGRIK = 10_000_000

/** No decimal key: both payment providers reject sub-tugrik amounts. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'] as const

/**
 * Amount entry for a custom invoice line, laid out for a tablet at the
 * counter. A physical keyboard works too: digits, Backspace, Enter, Escape.
 */
export function NumpadDialog({
  initialTugrik = 0,
  initialName = '',
  namePlaceholder,
  submitLabel,
  onSubmit,
  onClose,
}: {
  initialTugrik?: number
  initialName?: string
  namePlaceholder: string
  submitLabel: string
  onSubmit: (value: { tugrik: number; name: string }) => void
  onClose: () => void
}) {
  const [digits, setDigits] = useState(initialTugrik > 0 ? String(initialTugrik) : '')
  const [name, setName] = useState(initialName)

  const tugrik = digits === '' ? 0 : Number(digits)

  function press(key: (typeof KEYS)[number]) {
    setDigits((current) => {
      if (key === 'back') return current.slice(0, -1)
      const next = (current + key).replace(/^0+/, '')
      return Number(next || '0') > MAX_TUGRIK ? current : next
    })
  }

  function submit() {
    if (tugrik > 0) onSubmit({ tugrik, name: name.trim() })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      // Typing a name must not also type into the amount.
      if (event.target instanceof HTMLInputElement) {
        if (event.key === 'Enter') submit()
        return
      }
      if (/^\d$/.test(event.key)) press(event.key as (typeof KEYS)[number])
      else if (event.key === 'Backspace') press('back')
      else if (event.key === 'Enter') submit()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Дүн оруулах">
      <div className="modal__card numpad">
        <div className="modal__head">
          <h2>Дурын дүн</h2>
          <button type="button" className="modal__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <output className="numpad__display" aria-live="polite">
            {formatMnt(tugrikToMungu(tugrik))}
          </output>

          <div className="numpad__keys">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="numpad__key"
                aria-label={key === 'back' ? 'Устгах' : undefined}
                onClick={() => press(key)}
              >
                {key === 'back' ? '⌫' : key}
              </button>
            ))}
          </div>

          <label className="field numpad__name">
            <span>Нэр</span>
            <input
              value={name}
              maxLength={200}
              placeholder={namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>

        <div className="modal__foot">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={digits === ''}
            onClick={() => setDigits('')}
          >
            Цэвэрлэх
          </button>
          <button
            type="button"
            className="btn btn--sm"
            disabled={tugrik <= 0}
            onClick={submit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
