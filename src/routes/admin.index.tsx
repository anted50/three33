import { createFileRoute, Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import { getDashboard } from '~/lib/server/admin/admin'
import { STATUS_LABEL } from '~/components/admin-bits'
import {
  BarSpark,
  Donut,
  GoalBar,
  LineSpark,
} from '~/components/admin-charts'

export const Route = createFileRoute('/admin/')({
  loader: () => getDashboard(),
  component: Dashboard,
})

function Dashboard() {
  const data = Route.useLoaderData()

  return (
    <>
      {/* Three metric cards across the top, per the frame. */}
      <div className="adm__stats">
        <section className="adm__card metric">
          <div className="metric__head">
            <div>
              <h2>Нийт борлуулалт</h2>
              <p className="metric__sub">ЭНЭ САР</p>
            </div>
            <p className="metric__value">{formatMnt(data.revenueThisMonth)}</p>
          </div>
          <BarSpark values={data.salesSeries} />
        </section>

        <section className="adm__card metric">
          <div className="metric__head">
            <div>
              <h2>Хэрэглэгч</h2>
              <p className="metric__sub">ЭНЭ САР</p>
            </div>
            <p className="metric__value">{data.customersThisMonth}</p>
          </div>
          <LineSpark values={data.customerSeries} />
        </section>

        <section className="adm__card metric">
          <div className="metric__head">
            <div>
              <h2>Захиалга</h2>
              <p className="metric__sub">
                САРЫН ЗОРИЛТ : {data.orderGoal.toLocaleString('en-US')}
              </p>
            </div>
            <p className="metric__value">{data.ordersThisMonth}</p>
          </div>
          <div className="metric__goal">
            <p className="metric__left">{data.ordersLeft} үлдсэн</p>
            <GoalBar value={data.ordersThisMonth} goal={data.orderGoal} />
          </div>
        </section>
      </div>

      <div className="adm__cols adm__cols--dash">
        {/* Best selling, narrow left column. */}
        <section className="adm__card best">
          <div className="best__head">
            <h2>Шилдэг борлуулалт</h2>
            <p className="metric__sub">ЭНЭ САР</p>
          </div>

          <div className="best__body">
            <p className="best__total">
              {formatMnt(data.bestTotal)}
              <span> — нийт борлуулалт</span>
            </p>

            {data.best.length === 0 ? (
              <p className="adm__muted">Энэ сард борлуулалт хараахан алга.</p>
            ) : (
              <>
                <ul className="best__list">
                  {data.best.slice(0, 3).map((row) => (
                    <li key={row.name}>
                      {row.name} — <strong>{formatMnt(row.revenue)}</strong>
                    </li>
                  ))}
                </ul>

                <Donut
                  slices={data.best.slice(0, 3).map((row) => ({
                    label: row.name,
                    value: row.revenue,
                  }))}
                />
              </>
            )}
          </div>
        </section>

        {/* Recent orders, wide right column. */}
        <section className="adm__card">
          <div className="adm__cardhead">
            <h2>Сүүлийн захиалга</h2>
            <Link to="/admin/orders" className="pillbtn">
              Бүгдийг үзэх
            </Link>
          </div>

          {data.recent.length === 0 ? (
            <p className="adm__muted adm__pad">Захиалга алга.</p>
          ) : (
            <table className="adm__table">
              <thead>
                <tr>
                  <th>Бараа</th>
                  <th>Огноо</th>
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
                        {order.item ?? order.orderNo}
                      </Link>
                      {order.lines > 1 && (
                        <span className="adm__muted"> +{order.lines - 1}</span>
                      )}
                    </td>
                    <td className="adm__muted">
                      {new Date(order.createdAt).toLocaleDateString('mn-MN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="adm__num">{formatMnt(order.total)}</td>
                    <td className="adm__muted">{STATUS_LABEL[order.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/*
        Kept from the previous dashboard, below the frame's content: a shop
        needs to see what is about to run out, and nothing else surfaces it.
      */}
      <section className="adm__card">
        <div className="adm__cardhead">
          <h2>Дуусаж буй нөөц</h2>
          <Link to="/admin/products" className="pillbtn">
            Бүгд
          </Link>
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
                <td className="adm__muted adm__mono">{variant.sku}</td>
                <td>
                  <span
                    className="pill"
                    data-tone={
                      variant.stockQty === 0
                        ? 'out'
                        : variant.stockQty <= 10
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
    </>
  )
}
