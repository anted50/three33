import { useState } from 'react'
import { usePostHog } from '@posthog/react'
import { formatDateTime } from '~/lib/dates'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import type { OrderStatus } from '~/db/schema'
import { assert } from '~/lib/assert'
import { formatAddress } from '~/lib/address'
import { formatMnt } from '~/lib/money'
import type { ReceiptOutcome } from '~/lib/server/orders/receipt'
import {
  getOrderDetail,
  sendOrderReceiptNow,
  setOrderStatus,
} from '~/lib/server/admin/admin'
import { CopyButton, STATUS_LABEL, StatusBadge } from '~/components/admin-bits'

export const Route = createFileRoute('/admin/orders/$orderNo')({
  loader: ({ params }) => getOrderDetail({ data: { orderNo: params.orderNo } }),
  component: OrderDetail,
})

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

/**
 * Statuses whose money has landed, mirroring isPaid() in orders/state.ts — the
 * receipt says the order is confirmed, so it is only offered once that is true.
 * The server checks this too; here it just keeps the button from being armed.
 */
const RECEIPT_STATUSES: OrderStatus[] = [
  'paid',
  'processing',
  'shipped',
  'delivered',
]

/** Every outcome sendOrderReceiptNow can report, in the admin's language. */
const RECEIPT_NOTE: Record<ReceiptOutcome, string> = {
  sent: '✓ Баримт илгээлээ',
  no_email: 'И-мэйл хаяг бүртгэгдээгүй байна',
  not_found: 'Захиалга олдсонгүй',
  mail_disabled: 'И-мэйл тохиргоо дутуу байна (RESEND_API_KEY)',
}

/** What setOrderStatus accepts: an order only starts out pending payment. */
type SettableStatus = Exclude<OrderStatus, 'pending_payment'>

/**
 * Mirrors the server-side state machine so the UI only offers legal moves.
 * The server still asserts — this is convenience, not enforcement.
 */
const NEXT: Partial<Record<OrderStatus, SettableStatus[]>> = {
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  pending_payment: ['cancelled'],
}

type Order = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>

function OrderDetail() {
  const order = Route.useLoaderData()

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

  // Keyed so a move to another order starts with its own clean error state.
  return <OrderView key={order.orderNo} order={order} />
}

function OrderView({ order }: { order: Order }) {
  const posthog = usePostHog()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moves = NEXT[order.status] ?? []

  async function move(status: SettableStatus) {
    assert(moves.includes(status), `move: ${order.status} → ${status} is not offered`)
    setBusy(true)
    setError(null)
    try {
      await setOrderStatus({ data: { orderNo: order.orderNo, status } })
      posthog?.capture('order_status_updated', {
        next_status: status,
        previous_status: order.status,
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
        <StatusMoves moves={moves} busy={busy} onMove={move} />
      )}

      <div className="adm__cols">
        <OrderItems order={order} />

        <section className="adm__card adm__pad">
          <ShippingDetails order={order} />
          <PaymentDetails payment={order.payment} />
          <ReceiptSender order={order} />
        </section>
      </div>
    </>
  )
}

function StatusMoves({
  moves,
  busy,
  onMove,
}: {
  moves: SettableStatus[]
  busy: boolean
  onMove: (status: SettableStatus) => void
}) {
  return (
    <section className="adm__card adm__pad">
      <p className="adm__statlabel">Төлөв өөрчлөх</p>
      <div className="adm__actions">
        {moves.map((next) => (
          <button
            key={next}
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() => onMove(next)}
          >
            {STATUS_LABEL[next]}
          </button>
        ))}
      </div>
    </section>
  )
}

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

function OrderItems({ order }: { order: Order }) {
  return (
    <section className="adm__card">
      <div className="adm__cardhead">
        <h2>Бараа</h2>
      </div>
      <table className="adm__table">
        <tbody>
          {/* Keyed by position too: every custom invoice line has the SKU
              CUSTOM, so the SKU alone repeats within one order. */}
          {order.items.map((item, index) => (
            <tr key={`${item.sku}-${index}`}>
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
          <strong>{formatShippingFee(order.shippingFee)}</strong>
        </div>
        <div className="totals__row totals__row--grand">
          <span>Нийт</span>
          <strong>{formatMnt(order.total)}</strong>
        </div>
      </div>
    </section>
  )
}

function formatShippingFee(shippingFee: number): string {
  return shippingFee === 0 ? 'Үнэгүй' : formatMnt(shippingFee)
}

function ShippingDetails({ order }: { order: Order }) {
  const { address } = order

  return (
    <>
      <p className="adm__statlabel">Хүргэлт</p>

      <dl className="ship">
        {address.name && (
          <div className="ship__row">
            <dt>Хүлээн авагч</dt>
            <dd>{address.name}</dd>
          </div>
        )}
        <div className="ship__row">
          <dt>Утас</dt>
          <dd>
            <a href={`tel:+976${address.phone}`} className="ship__tel">
              {address.phone}
            </a>
          </dd>
        </div>
        <div className="ship__row">
          <dt>Хаяг</dt>
          <dd className="ship__addr">{formatAddress(address)}</dd>
        </div>
        <div className="ship__row">
          <dt>Хүргэлт</dt>
          <dd className="adm__num">{formatShippingFee(order.shippingFee)}</dd>
        </div>
        {address.email && (
          <div className="ship__row">
            <dt>И-мэйл</dt>
            <dd>{address.email}</dd>
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
      <CopyButton
        className="ship__copy"
        style={{ marginTop: 12 }}
        label="Хаяг хуулах"
        text={[address.name, address.phone, formatAddress(address), order.orderNo]
          .filter(Boolean)
          .join('\n')}
      />
    </>
  )
}

function PaymentDetails({ payment }: { payment: Order['payment'] }) {
  return (
    <>
      <p className="adm__statlabel" style={{ marginTop: 24 }}>
        Төлбөр
      </p>
      {payment ? (
        <p className="adm__muted adm__mono">
          {payment.status} · {payment.provider}
          <br />
          invoice: {payment.invoiceId ?? '—'}
          <br />
          payment: {payment.paymentId ?? '—'}
          <br />
          {payment.paidAt ? formatDateTime(payment.paidAt) : 'төлөгдөөгүй'}
        </p>
      ) : (
        <p className="adm__muted">Төлбөрийн бичлэг алга.</p>
      )}
    </>
  )
}

/**
 * The receipt goes out automatically when the order settles, but that send
 * is best-effort and silent when it fails — so this is how an order that
 * never got one is put right, without a redeploy or a SQL console.
 */
function ReceiptSender({ order }: { order: Order }) {
  const [mailBusy, setMailBusy] = useState(false)
  const [mailNote, setMailNote] = useState<string | null>(null)

  const receiptEmail = order.address.email
  const receiptReady = RECEIPT_STATUSES.includes(order.status)

  async function sendReceipt() {
    setMailBusy(true)
    setMailNote(null)
    try {
      const { outcome } = await sendOrderReceiptNow({
        data: { orderNo: order.orderNo },
      })
      setMailNote(RECEIPT_NOTE[outcome])
    } catch (err) {
      setMailNote(err instanceof Error ? err.message : 'Алдаа гарлаа')
    } finally {
      setMailBusy(false)
    }
  }

  return (
    <>
      <p className="adm__statlabel" style={{ marginTop: 24 }}>
        Баримт
      </p>
      {receiptEmail ? (
        <>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={mailBusy || !receiptReady}
            onClick={sendReceipt}
          >
            {mailBusy ? 'Илгээж байна…' : 'Баримт и-мэйлээр илгээх'}
          </button>
          <p className="adm__muted" style={{ marginTop: 8 }}>
            {mailNote ??
              (receiptReady
                ? `${receiptEmail} рүү илгээнэ.`
                : 'Төлбөр төлөгдсөний дараа илгээх боломжтой.')}
          </p>
        </>
      ) : (
        <p className="adm__muted">
          И-мэйл хаяг бүртгэгдээгүй тул баримт илгээх боломжгүй.
        </p>
      )}
    </>
  )
}
