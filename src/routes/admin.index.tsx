import { createFileRoute, Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import { getDashboard } from '~/lib/server/admin/admin'
import { StatusBadge } from '~/components/admin-bits'

export const Route = createFileRoute('/admin/')({
  loader: () => getDashboard(),
  component: Dashboard,
})

/** Below this a variant is worth chasing up with the distributor. */
const LOW = 10

function Dashboard() {
  const data = Route.useLoaderData()

  return (
    <>
      <header className="adm__head">
        <h1>Хяналтын самбар</h1>
      </header>

      <div className="adm__stats">
        <Stat
          label="Энэ сарын борлуулалт"
          value={formatMnt(data.revenueThisMonth)}
          sub={`${data.ordersThisMonth} захиалга`}
        />
        <Stat
          label="Төлбөр хүлээгдэж буй"
          value={String(data.pendingPayment)}
          sub="төлөгдөөгүй"
        />
        <Stat
          label="Боловсруулах"
          value={String(data.toFulfil)}
          sub="хүргэлтэд бэлэн"
        />
      </div>

      <div className="adm__cols">
        <section className="adm__card">
          <div className="adm__cardhead">
            <h2>Сүүлийн захиалга</h2>
            <Link to="/admin/orders">Бүгд →</Link>
          </div>

          {data.recent.length === 0 ? (
            <p className="adm__muted adm__pad">Захиалга алга.</p>
          ) : (
            <table className="adm__table">
              <thead>
                <tr>
                  <th>Дугаар</th>
                  <th>Хэрэглэгч</th>
                  <th>Дүн</th>
                  <th>Төлөв</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((order) => (
                  <tr key={order.orderNo}>
                    <td>
                      <Link
                        to="/admin/orders/$orderNo"
                        params={{ orderNo: order.orderNo }}
                      >
                        {order.orderNo}
                      </Link>
                    </td>
                    <td>{order.address?.name ?? '—'}</td>
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

        <section className="adm__card">
          <div className="adm__cardhead">
            <h2>Дуусаж буй нөөц</h2>
            <Link to="/admin/products">Бүгд →</Link>
          </div>
          <table className="adm__table">
            <thead>
              <tr>
                <th>Бүтээгдэхүүн</th>
                <th>SKU</th>
                <th>Үлдэгдэл</th>
              </tr>
            </thead>
            <tbody>
              {data.lowStock.map((variant) => (
                <tr key={variant.sku}>
                  <td>
                    <Link
                      to="/admin/products/$slug"
                      params={{ slug: variant.slug }}
                    >
                      {variant.name}
                      {variant.size ? ` ${variant.size}` : ''}
                    </Link>
                  </td>
                  <td className="adm__muted">{variant.sku}</td>
                  <td>
                    <span
                      className="pill"
                      data-tone={
                        variant.stockQty === 0
                          ? 'out'
                          : variant.stockQty <= LOW
                            ? 'low'
                            : undefined
                      }
                    >
                      {variant.stockQty}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {data.best.length > 0 && (
        <section className="adm__card">
          <div className="adm__cardhead">
            <h2>Энэ сарын шилдэг борлуулалт</h2>
          </div>
          <table className="adm__table">
            <thead>
              <tr>
                <th>Бүтээгдэхүүн</th>
                <th>Ширхэг</th>
                <th>Орлого</th>
              </tr>
            </thead>
            <tbody>
              {data.best.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.units}</td>
                  <td>{formatMnt(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="adm__card adm__stat">
      <p className="adm__statlabel">{label}</p>
      <p className="adm__statvalue">{value}</p>
      <p className="adm__muted">{sub}</p>
    </div>
  )
}
