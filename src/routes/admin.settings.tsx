import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import { getShopSettings, setShippingRates } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/settings')({
  loader: () => getShopSettings(),
  component: Settings,
})

/** Whole or fractional tugrik, zero or more; null for blank or anything else. */
function parseTugrik(text: string): number | null {
  if (text.trim() === '') return null
  const tugrik = Number(text)
  if (!Number.isFinite(tugrik)) return null
  if (tugrik < 0) return null
  return tugrik
}

/** The rates as setShippingRates takes them, in mungu. Throws a message. */
function parseRates(feeText: string, thresholdText: string) {
  const feeTugrik = parseTugrik(feeText)
  const thresholdTugrik = parseTugrik(thresholdText)

  if (feeTugrik === null) {
    throw new Error('Хүргэлтийн төлбөр буруу байна')
  }
  if (thresholdTugrik === null) {
    throw new Error('Үнэгүй хүргэлтийн босго буруу байна')
  }

  return {
    fee: tugrikToMungu(feeTugrik),
    freeThreshold: tugrikToMungu(thresholdTugrik),
  }
}

function Settings() {
  const rates = Route.useLoaderData()
  const router = useRouter()
  const [fee, setFee] = useState(String(munguToTugrik(rates.fee)))
  const [threshold, setThreshold] = useState(
    String(munguToTugrik(rates.freeThreshold)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True from a successful save until the next edit.
  const [saved, setSaved] = useState(false)

  async function save() {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await setShippingRates({ data: parseRates(fee, threshold) })
      setSaved(true)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Тохиргоо</h1>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <form
        className="adm__card adm__pad"
        onSubmit={(event) => {
          event.preventDefault()
          if (busy) return
          void save()
        }}
      >
        <div className="adm__cols">
          <RateField
            label="Хүргэлтийн төлбөр (₮)"
            value={fee}
            current={rates.fee}
            onChange={(value) => {
              setFee(value)
              setSaved(false)
            }}
          />
          <RateField
            label="Үнэгүй хүргэлтийн босго (₮)"
            value={threshold}
            current={rates.freeThreshold}
            onChange={(value) => {
              setThreshold(value)
              setSaved(false)
            }}
          />
        </div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Хадгалж байна…' : saved ? '✓ Хадгалсан' : 'Хадгалах'}
        </button>
      </form>
    </>
  )
}

/** A tugrik amount being edited, with the saved one under it. */
function RateField({
  label,
  value,
  current,
  onChange,
}: {
  label: string
  value: string
  /** The saved amount, in mungu. */
  current: number
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value)}
      />
      <small>Одоо: {formatMnt(current)}</small>
    </label>
  )
}
