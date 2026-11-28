import { createFileRoute, Link } from '@tanstack/react-router'
import { formatDateTime } from '~/lib/dates'
import { StatusBadge } from '~/components/admin-bits'
import { assert } from '~/lib/assert'
import { formatMnt } from '~/lib/money'
import { type InvoiceMethod, PAYMENT_METHOD_LABELS } from '~/lib/payment-methods'
import { getAdminInvoices } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/invoices/')({
  loader: () => getAdminInvoices(),
  component: Invoices,
})

type InvoiceRow = Awaited<ReturnType<typeof getAdminInvoices>>[number]

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
                <InvoiceTableRow key={invoice.orderNo} invoice={invoice} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function InvoiceTableRow({ invoice }: { invoice: InvoiceRow }) {
  return (
    <tr>
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
      <td>{invoice.provider ? methodLabel(invoice.provider) : '—'}</td>
      <td className="adm__muted adm__num">{invoice.phone || '—'}</td>
      <td className="adm__muted">{invoice.createdBy ?? '—'}</td>
      <td className="adm__num">{formatMnt(invoice.total)}</td>
      <td>
        <StatusBadge status={invoice.status} />
      </td>
    </tr>
  )
}

/** The payments row stores the method as plain text; only these are ever written. */
function methodLabel(provider: string): string {
  assert(Object.hasOwn(PAYMENT_METHOD_LABELS, provider), `unknown payment provider: ${provider}`)
  return PAYMENT_METHOD_LABELS[provider as InvoiceMethod]
}
