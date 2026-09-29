import { createFileRoute, Link } from '@tanstack/react-router'
import { formatDateTime } from '~/lib/dates'
import { StatusBadge } from '~/components/admin-bits'
import { formatMnt } from '~/lib/money'
import { PAYMENT_METHOD_LABELS } from '~/lib/payment-methods'
import { getAdminInvoices } from '~/lib/server/admin/admin'
import type { ProviderName } from '~/lib/server/payments/registry'

export const Route = createFileRoute('/admin/invoices/')({
  loader: () => getAdminInvoices(),
  component: Invoices,
})

/**
 * Invoices issued from here, newest first — unpaid ones included, unlike the
 * orders list, because an admin who just made one is waiting on it.
 */
function Invoices() {
  const invoices = Route.useLoaderData()

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Нэхэмжлэх</h1>
          <p className="adm__muted">
            QPay эсвэл StorePay-ээр дурын дүн, бараатай нэхэмжлэх үүсгэнэ
          </p>
        </div>
        <Link to="/admin/invoices/new" className="btn btn--sm">
          + Шинэ нэхэмжлэх
        </Link>
      </header>

      <section className="adm__card">
        {invoices.length === 0 ? (
          <p className="adm__muted adm__pad">
            Нэхэмжлэх алга. «Шинэ нэхэмжлэх» дарж эхэлнэ үү.
          </p>
        ) : (
          <table className="adm__table">
            <thead>
              <tr>
                <th>Дугаар</th>
                <th>Огноо</th>
                <th>Хэлбэр</th>
                <th>Утас</th>
                <th>Үүсгэсэн</th>
                <th>Дүн</th>
                <th>Төлөв</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.orderNo}>
                  <td>
                    <Link
                      to="/admin/invoices/$orderNo"
                      params={{ orderNo: invoice.orderNo }}
                    >
                      {invoice.orderNo}
                    </Link>
                  </td>
                  <td className="adm__muted">
                    {formatDateTime(invoice.createdAt)}
                  </td>
                  <td>
                    {invoice.provider
                      ? PAYMENT_METHOD_LABELS[invoice.provider as ProviderName]
                      : '—'}
                  </td>
                  <td className="adm__muted adm__num">{invoice.phone || '—'}</td>
                  <td className="adm__muted">{invoice.createdBy ?? '—'}</td>
                  <td className="adm__num">{formatMnt(invoice.total)}</td>
                  <td>
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
