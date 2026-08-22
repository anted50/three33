import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { useCartDrawer } from '~/components/cart-drawer'
import { formatMnt } from '~/lib/money'
import {
  MN_PROVINCES,
  ULAANBAATAR,
  unitsForProvince,
} from '~/lib/mn-regions'
import { getCart, getShippingRates } from '~/lib/server/cart/cart'
import { zoneForProvince } from '~/lib/server/cart/pricing'
import { createOrder } from '~/lib/server/orders/create'

export const Route = createFileRoute('/checkout/')({
  loader: async () => ({
    cart: await getCart(),
    rates: await getShippingRates(),
  }),
  component: Checkout,
})

function Checkout() {
  const { cart, rates } = Route.useLoaderData()
  const { openCart } = useCartDrawer()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Аймаг/хот → сум/дүүрэг. The second level is derived from the first, and
   * changing the first clears it: leaving 'Хан-Уул' selected after switching to
   * Дархан-Уул would submit a pair that does not exist.
   */
  const [province, setProvince] = useState<string>(ULAANBAATAR)
  const [district, setDistrict] = useState<string>('')
  const districts = unitsForProvince(province)

  /**
   * Computed from the server's own rates, so what is quoted here and what the
   * order is charged cannot drift. The server still recomputes at checkout —
   * this is a preview of that result, not an input to it.
   */
  const zone = zoneForProvince(province)
  const shipping =
    zone === 'ub' && cart.subtotal >= rates.freeUbThreshold ? 0 : rates[zone]

  if (cart.lines.length === 0) {
    return (
      <Page>
        <div className="wrap">
          <p className="empty">
            Сагс хоосон байхад захиалга үүсгэх боломжгүй.
            <br />
            <br />
            <Link to="/products" className="btn" style={{ maxWidth: 260 }}>
              Бүтээгдэхүүн үзэх
            </Link>
          </p>
        </div>
      </Page>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const form = new FormData(event.currentTarget)

    try {
      const result = await createOrder({
        data: {
          name: String(form.get('name') ?? ''),
          phone: String(form.get('phone') ?? ''),
          email: String(form.get('email') ?? ''),
          province: String(form.get('province') ?? ''),
          district: String(form.get('district') ?? ''),
          khoroo: String(form.get('khoroo') ?? ''),
          line1: String(form.get('line1') ?? ''),
          line2: String(form.get('line2') ?? ''),
          note: String(form.get('note') ?? ''),
          mapLink: String(form.get('mapLink') ?? ''),
        },
      })

      await navigate({
        to: '/checkout/payment/$orderNo',
        params: { orderNo: result.orderNo },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Захиалга үүсгэхэд алдаа гарлаа')
      setBusy(false)
    }
  }

  return (
    <Page>
      <div className="wrap">
        <p className="crumbs">
          {/* The cart is a drawer now, so there is no page to link back to. */}
          <button type="button" className="linkish" onClick={openCart}>
            Сагс
          </button>{' '}
          › Захиалга
        </p>

        <h1 className="page-title">Хүргэлтийн мэдээлэл</h1>

        <form onSubmit={onSubmit} className="form">
          <label className="field">
            <span>Нэр *</span>
            <input name="name" required maxLength={100} autoComplete="name" />
          </label>

          <label className="field">
            <span>Утас *</span>
            <input
              name="phone"
              required
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              placeholder="99112233"
              autoComplete="tel"
            />
            <small>8 оронтой дугаар</small>
          </label>

          <label className="field">
            <span>И-мэйл</span>
            <input name="email" type="email" autoComplete="email" />
            <small>Захиалгын баримт илгээхэд ашиглана</small>
          </label>

          <label className="field">
            <span>Аймаг / Хот *</span>
            <select
              name="province"
              required
              value={province}
              onChange={(e) => {
                setProvince(e.target.value)
                setDistrict('')
              }}
            >
              {MN_PROVINCES.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Сум / Дүүрэг *</span>
            <select
              name="district"
              required
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            >
              <option value="" disabled>
                Сонгоно уу
              </option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Баг / Хороо *</span>
            <input
              name="khoroo"
              required
              maxLength={100}
              placeholder={
                province === ULAANBAATAR ? '24-р хороо' : '1-р баг'
              }
            />
          </label>

          <label className="field">
            <span>Хаяг *</span>
            <input
              name="line1"
              required
              maxLength={255}
              placeholder="Байр, орц, тоот"
              autoComplete="street-address"
            />
          </label>

          <label className="field">
            <span>Нэмэлт хаяг</span>
            <input name="line2" maxLength={255} />
          </label>

          <label className="field">
            <span>Google Maps холбоос (заавал биш)</span>
            <input
              name="mapLink"
              type="url"
              maxLength={500}
              placeholder="https://maps.app.goo.gl/…"
            />
            <small>
              Хүргэлтийн жолооч танай хаягийг олоход хялбар болгоно
            </small>
            <details>
              <summary>Холбоосыг хэрхэн авах вэ?</summary>
              <ol>
                <li>Google Maps апп-аа нээгээд байршлаа олно уу</li>
                <li>Байршлыг дараад доор гарч ирэх картыг татна уу</li>
                <li>
                  <strong>Хуваалцах</strong> (Share) товч дараад{' '}
                  <strong>Холбоос хуулах</strong> (Copy link) сонгоно уу
                </li>
                <li>Дараа нь энд буулгана уу (Урт дараад &quot;Буулгах&quot;)</li>
              </ol>
              <p>
                Компьютер дээрээс бол{' '}
                <a
                  href="https://maps.google.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  maps.google.com
                </a>{' '}
                дээр байршлаа хайж олоод <strong>Хуваалцах</strong> →{' '}
                <strong>Холбоос хуулах</strong> дарна уу.
              </p>
            </details>
          </label>

          <label className="field">
            <span>Тэмдэглэл</span>
            <textarea name="note" maxLength={1000} rows={3} />
          </label>

          <div className="totals">
            <div className="totals__row">
              <span>Дүн</span>
              <strong>{formatMnt(cart.subtotal)}</strong>
            </div>
            <div className="totals__row">
              <span>Хүргэлт</span>
              <strong>{shipping === 0 ? 'Үнэгүй' : formatMnt(shipping)}</strong>
            </div>
            <div className="totals__row totals__row--grand">
              <span>Нийт</span>
              <strong>{formatMnt(cart.subtotal + shipping)}</strong>
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="buybar">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Түр хүлээнэ үү…' : 'Төлбөр төлөх'}
            </button>
          </div>
        </form>
      </div>
    </Page>
  )
}
