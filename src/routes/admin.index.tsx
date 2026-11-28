import { createFileRoute, Link } from '@tanstack/react-router'
import { formatDate } from '~/lib/dates'
import { formatMnt } from '~/lib/money'
import { sizeSuffix } from '~/lib/product-name'
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

type DashboardData = Awaited<ReturnType<typeof getDashboard>>

/** The best-sellers card lists and charts this many; the donut has room for four. */
const BEST_SHOWN_MAX = 3

/** At or under this many units a variant is flagged as running low. */
const STOCK_LOW_MAX = 10

function Dashboard() {
  const data = Route.useLoaderData()

  return (
    <>
      <MetricCards data={data} />

      <div className="adm__cols adm__cols--dash">
        <BestSellers best={data.best} bestTotal={data.bestTotal} />
        <RecentOrders recent={data.recent} />
      </div>

      <LowStock lowStock={data.lowStock} />
    </>
  )
}

/** Three metric cards across the top, per the frame. */
function MetricCards({ data }: { data: DashboardData }) {
  return (
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
  )
}

/** Best selling, the narrow left column. */
function BestSellers({
  best,
  bestTotal,
}: {
  best: DashboardData['best']
  bestTotal: number
}) {
  const top = best.slice(0, BEST_SHOWN_MAX)

  return (
    <section className="adm__card best">
      <div className="best__head">
        <h2>Шилдэг борлуулалт</h2>
        <p className="metric__sub">ЭНЭ САР</p>
      </div>

      <div className="best__body">
        <p className="best__total">
          {formatMnt(bestTotal)}
          <span>нийт борлуулалт</span>
        </p>

        {top.length === 0 ? (
          <p className="adm__muted">Энэ сард борлуулалт хараахан алга.</p>
        ) : (
          <>
            <ul className="best__list">
              {top.map((row) => (
                <li key={row.name}>
                  {row.name} — <strong>{formatMnt(row.revenue)}</strong>
                </li>
              ))}
            </ul>

            <Donut
              slices={top.map((row) => ({
                label: row.name,
                value: row.revenue,
              }))}
            />
          </>
        )}
      </div>
    </section>
  )
}

/** Recent orders, the wide right column. */
function RecentOrders({ recent }: { recent: DashboardData['recent'] }) {
  return (
    <section className="adm__card">
      <div className="adm__cardhead">
        <h2>Сүүлийн захиалга</h2>
        <Link to="/admin/orders" className="pillbtn">
          Бүгдийг үзэх
        </Link>
      </div>

      {recent.length === 0 ? (
        <p className="adm__muted adm__pad">Захиалга алга.</p>
      ) : (
        <table className="adm__table adm__table--fit">
          <thead>
            <tr>
              <th>Бараа</th>
              <th className="adm__wide">Огноо</th>
              <th>Дүн</th>
              <th className="adm__wide">Төлөв</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((order) => (
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
                <td className="adm__muted adm__wide">
                  {formatDate(order.createdAt)}
                </td>
                <td className="adm__num">{formatMnt(order.total)}</td>
                <td className="adm__muted adm__wide">
                  {STATUS_LABEL[order.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/**
 * Kept from the previous dashboard, below the frame's content: a shop needs
 * to see what is about to run out, and nothing else surfaces it.
 */
function LowStock({ lowStock }: { lowStock: DashboardData['lowStock'] }) {
  return (
    <section className="adm__card">
      <div className="adm__cardhead">
        <h2>Дуусаж буй нөөц</h2>
        <Link to="/admin/products" className="pillbtn">
          Бүгд
        </Link>
      </div>

      {/* The list is the lowest-stocked active variants, so it is only
          empty when the shop has nothing on sale at all. */}
      {lowStock.length === 0 ? (
        <p className="adm__muted adm__pad">Идэвхтэй бараа алга.</p>
      ) : (
        <table className="adm__table adm__table--fit">
          <thead>
            <tr>
              <th>Бүтээгдэхүүн</th>
              <th className="adm__wide">SKU</th>
              <th>Үлдэгдэл</th>
            </tr>
          </thead>
          <tbody>
            {lowStock.map((variant) => (
              <tr key={variant.sku}>
                <td>
                  <Link
                    to="/admin/products/$slug"
                    params={{ slug: variant.slug }}
                  >
                    {variant.name}
                    {sizeSuffix(variant.name, variant.size)}
                  </Link>
                </td>
                <td className="adm__muted adm__mono adm__wide">{variant.sku}</td>
                <td>
                  <span className="pill" data-tone={stockTone(variant.stockQty)}>
                    {variant.stockQty}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function stockTone(stockQty: number): 'out' | 'low' | undefined {
  if (stockQty === 0) return 'out'
  if (stockQty <= STOCK_LOW_MAX) return 'low'
  return undefined
}
