import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import type { OrderStatus } from '~/db/schema'
import { formatArea } from '~/lib/mn-regions'
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
/**
 * The fulfilment happy path, as a rail. Terminal states (cancelled, expired,
 * refunded) are not steps on it — they get a greyed-out rail plus the badge in
 * the header, rather than being squeezed into a linear progression they left.
 */
const TRACK: Array<{ status: OrderStatus; label: string }> = [
  { status: 'pending_payment', label: 'Төлбөр' },
  { status: 'paid', label: 'Төлөгдсөн' },
  { status: 'processing', label: 'Бэлтгэж буй' },
  { status: 'shipped', label: 'Илгээсэн' },
  { status: 'delivered', label: 'Хүргэгдсэн' },
]

function Track({ status }: { status: OrderStatus }) {
  const dead =
    status === 'cancelled' || status === 'expired' || status === 'refunded'
  const reached = TRACK.findIndex((step) => step.status === status)

  return (
    <div className="track">
      {TRACK.map((step, index) => (
        <div
          key={step.status}
          className="track__step"
          data-done={!dead && index <= reached}
          data-dead={dead}
        >
          <div className="track__bar" />
          {step.label}
        </div>
      ))}
    </div>
  )
}

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
  const [copied, setCopied] = useState(false)

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

      <section className="adm__card adm__pad">
        <p className="adm__statlabel">Явц</p>
        <Track status={order.status} />
      </section>

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

          <dl className="ship">
            <div className="ship__row">
              <dt>Хүлээн авагч</dt>
              <dd>{order.address.name}</dd>
            </div>
            <div className="ship__row">
              <dt>Утас</dt>
              <dd>
                <a href={`tel:+976${order.address.phone}`} className="ship__tel">
                  {order.address.phone}
                </a>
              </dd>
            </div>
            {order.address.province && (
              <div className="ship__row">
                <dt>Аймаг/Хот</dt>
                <dd>
                  {order.address.province}
                  <span className="ship__zone">
                    {order.address.zone === 'ub' ? 'Улаанбаатар' : 'Орон нутаг'}
                  </span>
                </dd>
              </div>
            )}
            <div className="ship__row">
              <dt>Сум/Дүүрэг</dt>
              <dd>
                {order.address.district}
                {/* Older orders carry no province, so the zone badge rides
                    here instead — it must appear exactly once. */}
                {!order.address.province && (
                  <span className="ship__zone">
                    {order.address.zone === 'ub' ? 'Улаанбаатар' : 'Орон нутаг'}
                  </span>
                )}
              </dd>
            </div>
            <div className="ship__row">
              <dt>Баг/Хороо</dt>
              <dd>{order.address.khoroo}</dd>
            </div>
            <div className="ship__row">
              <dt>Хаяг</dt>
              <dd>
                {order.address.line1}
                {order.address.line2 ? (
                  <>
                    <br />
                    {order.address.line2}
                  </>
                ) : null}
              </dd>
            </div>
            <div className="ship__row">
              <dt>Хүргэлт</dt>
              <dd className="adm__num">
                {order.shippingFee === 0
                  ? 'Үнэгүй'
                  : formatMnt(order.shippingFee)}
              </dd>
            </div>
            {order.address.email && (
              <div className="ship__row">
                <dt>И-мэйл</dt>
                <dd>{order.address.email}</dd>
              </div>
            )}
            {order.note && (
              <div className="ship__row">
                <dt>Тэмдэглэл</dt>
                <dd>{order.note}</dd>
              </div>
            )}
          </dl>

          {/*
            One click to get the whole address into a courier's app or an SMS.
            Retyping a Mongolian address by hand is where parcels go wrong.
          */}
          <button
            type="button"
            className="ship__copy"
            style={{ marginTop: 12 }}
            onClick={() => {
              void navigator.clipboard?.writeText(
                [
                  order.address.name,
                  order.address.phone,
                  formatArea(order.address),
                  order.address.line1,
                  order.address.line2,
                  order.address.mapLink,
                  order.orderNo,
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            }}
          >
            {copied ? '✓ Хуулсан' : 'Хаяг хуулах'}
          </button>

          {order.address.mapLink && (
            <div style={{ marginTop: 16 }}>
              <p className="adm__statlabel">Байршил (хэрэглэгчийн тэмдэглэсэн)</p>
              <a href={order.address.mapLink} target="_blank" rel="noreferrer">
                Google Maps дээр нээх ↗
              </a>
            </div>
          )}

          <p className="adm__statlabel" style={{ marginTop: 24 }}>
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
