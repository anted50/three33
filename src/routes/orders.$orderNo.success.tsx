import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Page } from '~/components/layout'
import { formatAddress } from '~/lib/address'
import { formatMnt } from '~/lib/money'
import { getOrder } from '~/lib/server/orders/queries'

/** Same access token as the payment page — see checkout.payment.$orderNo.tsx. */
const successSearch = z.object({ t: z.string().max(200).optional() })

export const Route = createFileRoute('/orders/$orderNo/success')({
  validateSearch: successSearch,
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: ({ params, deps }) =>
    getOrder({ data: { orderNo: params.orderNo, token: deps.t } }),
  component: Success,
})

function Success() {
  const order = Route.useLoaderData()

  if (!order) {
    return (
      <Page>
        <div className="wrap">
          <p className="empty">Захиалга олдсонгүй.</p>
        </div>
      </Page>
    )
  }

  const address = order.address
  const paid = order.status !== 'pending_payment' && order.status !== 'expired'

  return (
    <Page>
      <div className="wrap">
        <div className="success">
          <div className="success__mark" aria-hidden>
            ✓
          </div>
          <h1>{paid ? 'Захиалга баталгаажлаа' : 'Захиалга хүлээгдэж байна'}</h1>
          <p className="crumbs">Захиалгын дугаар: {order.orderNo}</p>
        </div>

        <ul className="lines lines--compact">
          {order.items.map((item) => (
            <li key={item.sku} className="line line--compact">
              <span>
                {item.name} × {item.qty}
              </span>
              <strong>{formatMnt(item.unitPrice * item.qty)}</strong>
            </li>
          ))}
        </ul>

        <div className="totals">
          <div className="totals__row">
            <span>Дүн</span>
            <strong>{formatMnt(order.subtotal)}</strong>
          </div>
          <div className="totals__row">
            <span>Хүргэлт</span>
            <strong>
              {order.shippingFee === 0 ? 'Үнэгүй' : formatMnt(order.shippingFee)}
            </strong>
          </div>
          <div className="totals__row totals__row--grand">
            <span>Нийт</span>
            <strong>{formatMnt(order.total)}</strong>
          </div>
        </div>

        <div className="prose">
          <h2>Хүргэлтийн хаяг</h2>
          <p>
            {address.name} · {address.phone}
            <br />
            {formatAddress(address)}
          </p>
          {order.note && <p className="crumbs">Тэмдэглэл: {order.note}</p>}
        </div>

        <div className="buybar">
          <Link to="/products" className="btn btn--ghost">
            Үргэлжлүүлэн худалдан авах
          </Link>
        </div>
      </div>
    </Page>
  )
}
