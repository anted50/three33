import { useEffect, useState } from 'react'
import { formatDateTime } from '~/lib/dates'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { StatusBadge } from '~/components/admin-bits'
import { formatCountdown } from '~/lib/countdown'
import { formatMnt } from '~/lib/money'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_LOGOS } from '~/lib/payment-methods'
import { getAdminInvoice, setOrderStatus } from '~/lib/server/admin/admin'
import type { ProviderName } from '~/lib/server/payments/registry'

export const Route = createFileRoute('/admin/invoices/$orderNo')({
  loader: ({ params }) => getAdminInvoice({ data: { orderNo: params.orderNo } }),
  component: InvoiceDetail,
})

/** Re-asking the provider on every tick is throttled server-side anyway. */
const POLL_MS = 3000

function InvoiceDetail() {
  const invoice = Route.useLoaderData()
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const pending = invoice?.status === 'pending_payment'
  const expired = invoice ? now >= invoice.expiresAt : false

  // Poll while the server still says pending — the loader asks the provider
  // each time, and once the window has closed it expires the invoice, which
  // is what ends this. Stopping at the local clock instead could leave it
  // pending if that last check landed inside settleOrder's throttle.
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void router.invalidate(), POLL_MS)
    return () => clearInterval(timer)
  }, [pending, router])

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending])

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

  const provider = (invoice.payment?.provider ?? 'qpay') as ProviderName
  const payload = invoice.payment?.payload

  async function cancel() {
    if (!confirm('Энэ нэхэмжлэхийг цуцлах уу?')) return
    setBusy(true)
    setError(null)
    try {
      await setOrderStatus({ data: { orderNo: invoice!.orderNo, status: 'cancelled' } })
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
        <section className="adm__card adm__pad invoice-pay">
          <p className="adm__statlabel invoice-pay__method">
            <img src={PAYMENT_METHOD_LOGOS[provider]} alt="" width={18} height={18} />
            {PAYMENT_METHOD_LABELS[provider]}
          </p>
          <p className="invoice-pay__amount">{formatMnt(invoice.total)}</p>

          {pending && !expired && (
            <>
              {provider === 'storepay' ? (
                <p className="adm__muted">
                  Нэхэмжлэх <strong>{invoice.address.phone}</strong> дугаар руу
                  илгээгдлээ. Хэрэглэгч StorePay апп-аараа нэвтэрч баталгаажуулна.
                </p>
              ) : payload?.qrImage ? (
                <>
                  <img
                    className="invoice-pay__qr"
                    src={`data:image/png;base64,${payload.qrImage}`}
                    alt={`QPay QR — ${invoice.orderNo}`}
                    width={240}
                    height={240}
                  />
                  {payload.shortUrl && (
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(payload.shortUrl!)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1600)
                      }}
                    >
                      {copied ? '✓ Хуулсан' : 'Төлбөрийн холбоос хуулах'}
                    </button>
                  )}
                </>
              ) : null}

              <p className="polling">
                <span className="spinner" aria-hidden /> Төлбөр хүлээж байна… ·{' '}
                <Countdown msLeft={invoice.expiresAt - now} />
              </p>

              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={busy}
                onClick={cancel}
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
      </div>
    </>
  )
}

function Countdown({ msLeft }: { msLeft: number }) {
  return <strong>{formatCountdown(msLeft)}</strong>
}
