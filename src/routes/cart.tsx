import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { formatMnt } from '~/lib/money'
import { getCart, setCartQty } from '~/lib/server/cart/cart'

export const Route = createFileRoute('/cart')({
  loader: () => getCart(),
  component: Cart,
})

function Cart() {
  const cart = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function change(variantId: string, qty: number) {
    setBusy(true)
    try {
      await setCartQty({ data: { variantId, qty } })
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  if (cart.lines.length === 0) {
    return (
      <Page>
        <div className="wrap">
          <p className="empty">
            Таны сагс хоосон байна.
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

  return (
    <Page>
      <div className="wrap">
        <div className="section-head">
          <h2>Сагс</h2>
          <span>{cart.itemCount} ширхэг</span>
        </div>

        <ul className="lines">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="line">
              <div className="line__media">
                {line.imageUrl ? (
                  <img src={line.imageUrl} alt={line.productName} />
                ) : (
                  <span className="card__ph">{line.productName}</span>
                )}
              </div>

              <div className="line__body">
                <Link
                  to="/products/$slug"
                  params={{ slug: line.productSlug }}
                  className="line__name"
                >
                  {line.productName}
                  {line.size ? ` ${line.size}` : ''}
                </Link>
                <p className="line__price">{formatMnt(line.unitPrice)}</p>

                <div className="line__foot">
                  <div className="qty qty--sm">
                    <button
                      type="button"
                      onClick={() => change(line.variantId, line.qty - 1)}
                      disabled={busy}
                      aria-label="Хасах"
                    >
                      −
                    </button>
                    <span>{line.qty}</span>
                    <button
                      type="button"
                      onClick={() => change(line.variantId, line.qty + 1)}
                      disabled={busy || line.qty >= line.stockQty}
                      aria-label="Нэмэх"
                    >
                      +
                    </button>
                  </div>

                  <strong>{formatMnt(line.lineTotal)}</strong>
                </div>

                <button
                  type="button"
                  className="linkish"
                  onClick={() => change(line.variantId, 0)}
                  disabled={busy}
                >
                  Устгах
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="totals">
          <div className="totals__row">
            <span>Дүн</span>
            <strong>{formatMnt(cart.subtotal)}</strong>
          </div>
          <p className="totals__note">
            Хүргэлтийн төлбөр хаягаа оруулсны дараа тооцогдоно.
          </p>
        </div>

        <div className="buybar">
          <Link to="/checkout" className="btn">
            Захиалах
          </Link>
        </div>
      </div>
    </Page>
  )
}
