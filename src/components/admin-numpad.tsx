import { useEffect, useState } from 'react'
import { formatMnt, tugrikToMungu } from '~/lib/money'

/** 10,000,000₮ — the invoice line's own unit-price ceiling, in tugrik. */
const MAX_TUGRIK = 10_000_000

/** No decimal key: both payment providers reject sub-tugrik amounts. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'] as const

/**
 * Amount entry for a custom invoice line, laid out for a tablet at the
 * counter. Sits inline on the page rather than in a dialog, and resets after
 * each add so several lines can be keyed in a row.
 *
 * With `captureKeys` a physical keyboard works too — digits, Backspace,
 * Enter — as long as focus isn't in some other field on the page.
 */
export function Numpad({
  namePlaceholder,
  submitLabel,
  captureKeys = false,
  onSubmit,
}: {
  namePlaceholder: string
  submitLabel: string
  captureKeys?: boolean
  onSubmit: (value: { tugrik: number; name: string }) => void
}) {
  const [digits, setDigits] = useState('')
  const [name, setName] = useState('')

  const tugrik = digits === '' ? 0 : Number(digits)

  function press(key: (typeof KEYS)[number]) {
    setDigits((current) => {
      if (key === 'back') return current.slice(0, -1)
      const next = (current + key).replace(/^0+/, '')
      return Number(next || '0') > MAX_TUGRIK ? current : next
    })
  }

  function submit() {
    if (tugrik <= 0) return
    onSubmit({ tugrik, name: name.trim() })
    setDigits('')
    setName('')
  }

  useEffect(() => {
    if (!captureKeys) return
    const onKey = (event: KeyboardEvent) => {
      // Typing a phone number or a qty elsewhere must not also type here.
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
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
    <div className="numpad">
      <label className="field numpad__name">
        <span>Нэр</span>
        <input
          value={name}
          maxLength={200}
          placeholder={namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>

      <output className="numpad__display" aria-live="polite" data-empty={digits === ''}>
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

      <div className="numpad__foot">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={digits === ''}
          onClick={() => setDigits('')}
        >
          Цэвэрлэх
        </button>
        <button type="button" className="btn" disabled={tugrik <= 0} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
