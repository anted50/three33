import { useEffect, useState } from 'react'
import { formatDateTime } from '~/lib/dates'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { CopyButton, StatusBadge } from '~/components/admin-bits'
import { assert } from '~/lib/assert'
import { formatCountdown } from '~/lib/countdown'
import { formatMnt } from '~/lib/money'
import {
  type InvoiceMethod,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LOGOS,
} from '~/lib/payment-methods'
import { getAdminInvoice, setOrderStatus } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/invoices/$orderNo')({
  loader: ({ params }) => getAdminInvoice({ data: { orderNo: params.orderNo } }),
  component: InvoiceDetail,
})

/** Re-asking the provider on every tick is throttled server-side anyway. */
const POLL_MS = 3000

/** The countdown only shows whole seconds. */
const CLOCK_TICK_MS = 1000

type Invoice = NonNullable<Awaited<ReturnType<typeof getAdminInvoice>>>

function InvoiceDetail() {
  const invoice = Route.useLoaderData()

  if (!invoice) {
    return (
      <>
        <header className="adm__head">
          <h1>Нэхэмжлэх олдсонгүй</h1>
        </header>
        <Link to="/admin/invoices">← Буцах</Link>
      </>
    )
  }

  // Keyed so a move to another invoice starts with its own clean state.
  return <InvoiceView key={invoice.orderNo} invoice={invoice} />
}

function InvoiceView({ invoice }: { invoice: Invoice }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = invoice.status === 'pending_payment'
  const now = useClock(pending)
  useReloadWhile(pending)

  async function cancel() {
    if (!confirm('Энэ нэхэмжлэхийг цуцлах уу?')) return
    setBusy(true)
    setError(null)
    try {
      await setOrderStatus({ data: { orderNo: invoice.orderNo, status: 'cancelled' } })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Цуцалж чадсангүй')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <p className="adm__muted">
            <Link to="/admin/invoices">Нэхэмжлэх</Link> ›
          </p>
          <h1>{invoice.orderNo}</h1>
        </div>
        <StatusBadge status={invoice.status} />
      </header>

      {error && <p className="error">{error}</p>}

      <div className="adm__cols">
        <PaymentCard invoice={invoice} now={now} busy={busy} onCancel={cancel} />
        <InvoiceLines invoice={invoice} />
      </div>
    </>
  )
}

function PaymentCard({
  invoice,
  now,
  busy,
  onCancel,
}: {
  invoice: Invoice
  now: number
  busy: boolean
  onCancel: () => void
}) {
  const pending = invoice.status === 'pending_payment'
  const expired = now >= invoice.expiresAt
  const provider = toInvoiceMethod(invoice.payment?.provider ?? 'qpay')

  return (
    <section className="adm__card adm__pad invoice-pay">
      <p className="adm__statlabel invoice-pay__method">
        <img src={PAYMENT_METHOD_LOGOS[provider]} alt="" width={18} height={18} />
        {PAYMENT_METHOD_LABELS[provider]}
      </p>
      <p className="invoice-pay__amount">{formatMnt(invoice.total)}</p>

      {pending && !expired && (
        <>
          <PaymentPrompt invoice={invoice} provider={provider} />

          <p className="polling">
            <span className="spinner" aria-hidden /> Төлбөр хүлээж байна… ·{' '}
            <Countdown msLeft={invoice.expiresAt - now} />
          </p>

          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Нэхэмжлэх цуцлах
          </button>
        </>
      )}

      {pending && expired && (
        <p className="adm__muted">
          Хугацаа дууссан. Удахгүй автоматаар цуцлагдана — шинээр үүсгэнэ үү.
        </p>
      )}

      {!pending && invoice.payment?.paidAt && (
        <p className="invoice-pay__paid">
          ✓ Төлөгдсөн · {formatDateTime(invoice.payment.paidAt)}
        </p>
      )}

      <p style={{ marginTop: 16 }}>
        <Link to="/admin/orders/$orderNo" params={{ orderNo: invoice.orderNo }}>
          Захиалгын дэлгэрэнгүй →
        </Link>
      </p>
    </section>
  )
}

/**
 * Reloads the route's data every POLL_MS while `active`.
 *
 * Polls while the server still says pending — the loader asks the provider
 * each time, and once the window has closed it expires the invoice, which is
 * what ends this. Stopping at the local clock instead could leave it pending
 * if that last check landed inside settleOrder's throttle.
 *
 * Each reload waits for the one before it to finish, so a slow provider
 * cannot stack up overlapping requests the way a fixed interval would.
 */
function useReloadWhile(active: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer = window.setTimeout(reload, POLL_MS)

    async function reload() {
      try {
        await router.invalidate()
      } catch (error) {
        // A failed poll is retried on the next tick rather than ending the wait.
        console.error('Invoice poll failed:', error)
      }
      if (!stopped) timer = window.setTimeout(reload, POLL_MS)
    }

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [active, router])
}

/** The current time in epoch milliseconds, re-read every second while `ticking`. */
function useClock(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [ticking])

  return now
}

/** How the customer pays: StorePay asks them in its app, QPay shows a QR. */
function PaymentPrompt({ invoice, provider }: { invoice: Invoice; provider: InvoiceMethod }) {
  const payload = invoice.payment?.payload

  if (provider === 'storepay') {
    return (
      <p className="adm__muted">
        Нэхэмжлэх <strong>{invoice.address.phone}</strong> дугаар руу
        илгээгдлээ. Хэрэглэгч StorePay апп-аараа нэвтэрч баталгаажуулна.
      </p>
    )
  }

  if (!payload?.qrImage) return null

  return (
    <>
      <img
        className="invoice-pay__qr"
        src={`data:image/png;base64,${payload.qrImage}`}
        alt={`QPay QR — ${invoice.orderNo}`}
        width={240}
        height={240}
      />
      {payload.shortUrl && (
        <CopyButton
          className="btn btn--sm btn--ghost"
          label="Төлбөрийн холбоос хуулах"
          text={payload.shortUrl}
        />
      )}
    </>
  )
}

function InvoiceLines({ invoice }: { invoice: Invoice }) {
  return (
    <section className="adm__card">
      <div className="adm__cardhead">
        <h2>Мөрүүд</h2>
      </div>
      <table className="adm__table">
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={`${item.sku}-${index}`}>
              <td>
                {item.name}
                {item.sku !== 'CUSTOM' && (
                  <>
                    <br />
                    <span className="adm__muted adm__mono">{item.sku}</span>
                  </>
                )}
              </td>
              <td>× {item.qty}</td>
              <td className="adm__num">{formatMnt(item.unitPrice * item.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="adm__pad">
        <div className="totals__row totals__row--grand">
          <span>Нийт</span>
          <strong>{formatMnt(invoice.total)}</strong>
        </div>
        <p className="adm__muted adm__hint">
          {formatDateTime(invoice.createdAt)}
          {invoice.createdBy ? ` · ${invoice.createdBy}` : ''}
          {invoice.address.phone ? ` · ${invoice.address.phone}` : ''}
          {invoice.note ? ` · ${invoice.note}` : ''}
        </p>
      </div>
    </section>
  )
}

/** The payments row stores the method as plain text; only these are ever written. */
function toInvoiceMethod(provider: string): InvoiceMethod {
  assert(Object.hasOwn(PAYMENT_METHOD_LABELS, provider), `unknown payment provider: ${provider}`)
  return provider as InvoiceMethod
}

/**
 * The server renders this with its own clock and the browser hydrates it with
 * a slightly later one, so the seconds can differ; the next tick corrects it.
 */
function Countdown({ msLeft }: { msLeft: number }) {
  return <strong suppressHydrationWarning>{formatCountdown(msLeft)}</strong>
}
