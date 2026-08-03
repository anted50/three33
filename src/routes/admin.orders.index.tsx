import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { formatMnt } from '~/lib/money'
import { getOrders } from '~/lib/server/admin/admin'
import { STATUS_LABEL, StatusBadge } from '~/components/admin-bits'

const searchSchema = z.object({
  status: z.string().max(32).optional(),
})

export const Route = createFileRoute('/admin/orders/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: ({ deps }) => getOrders({ data: { status: deps.status } }),
  component: Orders,
})

/** Ordered by how often a shop actually filters, not by the enum. */
const FILTERS = [
  'all',
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const

function Orders() {
  const orders = Route.useLoaderData()
  const { status } = Route.useSearch()
  const active = status ?? 'all'

  return (
    <>
      <header className="adm__head">
        <h1>Захиалга</h1>
      </header>

      <div className="chips">
        {FILTERS.map((f) => (
          <Link
            key={f}
            to="/admin/orders"
            search={f === 'all' ? {} : { status: f }}
            className="chip"
            data-active={active === f}
          >
            {f === 'all'
              ? 'Бүгд'
              : STATUS_LABEL[f as keyof typeof STATUS_LABEL]}
          </Link>
        ))}
      </div>

      <section className="adm__card">
        {orders.length === 0 ? (
          <p className="adm__muted adm__pad">Энэ төлөвт захиалга алга.</p>
        ) : (
          <table className="adm__table">
            <thead>
              <tr>
                <th>Дугаар</th>
                <th>Огноо</th>
                <th>Хэрэглэгч</th>
                <th>Утас</th>
                <th>Ширхэг</th>
                <th>Дүн</th>
                <th>Төлөв</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderNo}>
                  <td>
                    <Link
                      to="/admin/orders/$orderNo"
                      params={{ orderNo: order.orderNo }}
                    >
                      {order.orderNo}
                    </Link>
                  </td>
                  <td className="adm__muted">
                    {new Date(order.createdAt).toLocaleDateString('mn-MN')}
                  </td>
                  <td>{order.address?.name ?? '—'}</td>
                  <td className="adm__muted">{order.phone}</td>
                  <td>{order.items}</td>
                  <td>{formatMnt(order.total)}</td>
                  <td>
                    <StatusBadge status={order.status} />
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
