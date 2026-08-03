import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import type { OrderStatus } from '~/db/schema'
import { formatMnt } from '~/lib/money'
import { getOrderDetail, setOrderStatus } from '~/lib/server/admin/admin'
import { STATUS_LABEL, StatusBadge } from '~/components/admin-bits'

export const Route = createFileRoute('/admin/orders/$orderNo')({
  loader: ({ params }) => getOrderDetail({ data: { orderNo: params.orderNo } }),
  component: OrderDetail,
})

/**
 * Mirrors the server-side state machine so the UI only offers legal moves.
 * The server still asserts — this is convenience, not enforcement.
 */
const NEXT: Partial<Record<OrderStatus, OrderStatus[]>> = {
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  pending_payment: ['cancelled'],
}

function OrderDetail() {
  const order = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!order) {
    return (
      <>
        <header className="adm__head">
          <h1>Захиалга олдсонгүй</h1>
        </header>
        <Link to="/admin/orders">← Буцах</Link>
      </>
    )
  }

  const moves = NEXT[order.status] ?? []

  async function move(status: OrderStatus) {
    setBusy(true)
    setError(null)
    try {
      await setOrderStatus({
        data: { orderNo: order!.orderNo, status: status as never },
      })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <p className="adm__muted">
            <Link to="/admin/orders">Захиалга</Link> ›
          </p>
          <h1>{order.orderNo}</h1>
        </div>
        <StatusBadge status={order.status} />
      </header>

      {error && <p className="error">{error}</p>}

      {moves.length > 0 && (
        <section className="adm__card adm__pad">
          <p className="adm__statlabel">Төлөв өөрчлөх</p>
          <div className="adm__actions">
            {moves.map((next) => (
              <button
                key={next}
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy}
                onClick={() => move(next)}
              >
                {STATUS_LABEL[next]}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="adm__cols">
        <section className="adm__card">
          <div className="adm__cardhead">
            <h2>Бараа</h2>
          </div>
          <table className="adm__table">
            <tbody>
              {order.items.map((item) => (
                <tr key={item.sku}>
                  <td>
                    {item.name}
                    <br />
                    <span className="adm__muted">{item.sku}</span>
                  </td>
                  <td>× {item.qty}</td>
                  <td>{formatMnt(item.unitPrice * item.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="adm__pad">
            <div className="totals__row">
              <span>Дүн</span>
              <strong>{formatMnt(order.subtotal)}</strong>
            </div>
            <div className="totals__row">
              <span>Хүргэлт</span>
              <strong>
                {order.shippingFee === 0
                  ? 'Үнэгүй'
                  : formatMnt(order.shippingFee)}
              </strong>
            </div>
            <div className="totals__row totals__row--grand">
              <span>Нийт</span>
              <strong>{formatMnt(order.total)}</strong>
            </div>
          </div>
        </section>

        <section className="adm__card adm__pad">
          <p className="adm__statlabel">Хүргэлт</p>
          <p>
            {order.address.name}
            <br />
            {order.address.phone}
            <br />
            {order.address.district}, {order.address.khoroo}
            <br />
            {order.address.line1}
            {order.address.line2 ? `, ${order.address.line2}` : ''}
          </p>
          {order.note && (
            <p className="adm__muted" style={{ marginTop: 12 }}>
              Тэмдэглэл: {order.note}
            </p>
          )}

          <p className="adm__statlabel" style={{ marginTop: 20 }}>
            Төлбөр
          </p>
          {order.payment ? (
            <p className="adm__muted adm__mono">
              {order.payment.status}
              <br />
              invoice: {order.payment.qpayInvoiceId ?? '—'}
              <br />
              payment: {order.payment.qpayPaymentId ?? '—'}
              <br />
              {order.payment.paidAt
                ? new Date(order.payment.paidAt).toLocaleString('mn-MN')
                : 'төлөгдөөгүй'}
            </p>
          ) : (
            <p className="adm__muted">Төлбөрийн бичлэг алга.</p>
          )}
        </section>
      </div>
    </>
  )
}
