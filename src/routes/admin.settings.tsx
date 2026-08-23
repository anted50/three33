import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import { getShopSettings, setShippingRates } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/settings')({
  loader: () => getShopSettings(),
  component: Settings,
})

function Settings() {
  const rates = Route.useLoaderData()
  const router = useRouter()
  const [fee, setFee] = useState(String(munguToTugrik(rates.fee)))
  const [threshold, setThreshold] = useState(
    String(munguToTugrik(rates.freeThreshold)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Тохиргоо</h1>
          <p className="adm__muted">Хүргэлтийн төлбөр</p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <form
        className="adm__card adm__pad"
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          setSaved(false)

          const feeTugrik = Number(fee)
          const thresholdTugrik = Number(threshold)

          if (!Number.isFinite(feeTugrik) || feeTugrik < 0) {
            setError('Хүргэлтийн төлбөр буруу байна')
            return
          }
          if (!Number.isFinite(thresholdTugrik) || thresholdTugrik < 0) {
            setError('Үнэгүй хүргэлтийн босго буруу байна')
            return
          }

          setBusy(true)
          try {
            await setShippingRates({
              data: {
                fee: tugrikToMungu(feeTugrik),
                freeThreshold: tugrikToMungu(thresholdTugrik),
              },
            })
            setSaved(true)
            await router.invalidate()
          } catch (err) {
            setError(
              err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="adm__cols">
          <label className="field">
            <span>Хүргэлтийн төлбөр (₮)</span>
            <input
              value={fee}
              inputMode="numeric"
              onChange={(e) => setFee(e.target.value)}
            />
            <small>Одоо: {formatMnt(rates.fee)}</small>
          </label>

          <label className="field">
            <span>Үнэгүй хүргэлтийн босго (₮)</span>
            <input
              value={threshold}
              inputMode="numeric"
              onChange={(e) => setThreshold(e.target.value)}
            />
            <small>Одоо: {formatMnt(rates.freeThreshold)}</small>
          </label>
        </div>

        <p className="adm__muted adm__hint">
          Энэ дүнгээс дээш захиалгын хүргэлт үнэгүй болно. Өөрчлөлт шинэ
          захиалгад шууд үйлчилнэ.
        </p>

        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Хадгалж байна…' : saved ? '✓ Хадгалсан' : 'Хадгалах'}
        </button>
      </form>
    </>
  )
}
