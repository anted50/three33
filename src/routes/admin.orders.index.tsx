import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { formatAddress } from '~/lib/address'
import { formatMnt } from '~/lib/money'
import { exportOrders, getOrders } from '~/lib/server/admin/admin'
import { STATUS_LABEL, StatusBadge } from '~/components/admin-bits'
import { ChevronLeftIcon, ChevronRightIcon } from '~/components/admin-icons'

const searchSchema = z.object({
  status: z.string().max(32).optional(),
  dateFrom: z.string().max(10).optional(),
  dateTo: z.string().max(10).optional(),
  page: z.number().int().min(1).optional(),
})

export const Route = createFileRoute('/admin/orders/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    status: search.status,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    page: search.page,
  }),
  loader: ({ deps }) => getOrders({ data: deps }),
  component: Orders,
})

/**
 * Ordered by how often a shop actually filters, not by the enum. "all" excludes
 * cancelled and expired checkouts — these two chips are how you reach them.
 * Unpaid checkouts aren't listed at all, so they get no chip.
 */
const FILTERS = [
  'all',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'expired',
] as const

function Orders() {
  const { rows, total, page, pageSize } = Route.useLoaderData()
  const { status, dateFrom, dateTo } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const active = status ?? 'all'

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const { filename, base64 } = await exportOrders({
        data: { status, dateFrom, dateTo },
      })
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Экспортод алдаа гарлаа')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <header className="adm__head">
        <h1>Захиалга</h1>
      </header>

      <div className="adm__toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <Link
              key={f}
              to="/admin/orders"
              search={(prev) => ({
                ...prev,
                status: f === 'all' ? undefined : f,
                page: undefined,
              })}
              className="chip"
              data-active={active === f}
            >
              {f === 'all'
                ? 'Бүгд'
                : STATUS_LABEL[f as keyof typeof STATUS_LABEL]}
            </Link>
          ))}
        </div>

        <div className="adm__daterange">
          <label className="field">
            <span>Эхлэх огноо</span>
            <input
              type="date"
              value={dateFrom ?? ''}
              max={dateTo}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    dateFrom: e.target.value || undefined,
                    page: undefined,
                  }),
                })
              }
            />
          </label>

          <label className="field">
            <span>Дуусах огноо</span>
            <input
              type="date"
              value={dateTo ?? ''}
              min={dateFrom}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    dateTo: e.target.value || undefined,
                    page: undefined,
                  }),
                })
              }
            />
          </label>

          {(dateFrom || dateTo) && (
            <button
              type="button"
              className="linkish"
              onClick={() =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    dateFrom: undefined,
                    dateTo: undefined,
                    page: undefined,
                  }),
                })
              }
            >
              Огноо цэвэрлэх
            </button>
          )}
        </div>

        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={exporting}
          onClick={handleExport}
        >
          {exporting ? 'Бэлтгэж байна…' : 'Excel татах'}
        </button>
      </div>

      {exportError && <p className="error">{exportError}</p>}

      <section className="adm__card">
        {rows.length === 0 ? (
          <p className="adm__muted adm__pad">Тохирох захиалга алга.</p>
        ) : (
          <table className="adm__table">
            <thead>
              <tr>
                <th>Дугаар</th>
                <th>Огноо</th>
                <th>Утас</th>
                <th>Хүргэлт</th>
                <th>Ширхэг</th>
                <th>Дүн</th>
                <th>Төлөв</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
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
                  <td className="adm__muted adm__num">{order.phone}</td>
                  <td className="adm__muted adm__ellipsis">
                    {order.address ? formatAddress(order.address) : '—'}
                  </td>
                  <td className="adm__num">{order.items}</td>
                  <td className="adm__num">{formatMnt(order.total)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > 0 && (
          <div className="adm__pager">
            <span className="adm__muted">
              {page} / {totalPages} ({total})
            </span>
            <button
              type="button"
              className="adm__iconbtn adm__iconbtn--neutral"
              title="Өмнөх"
              aria-label="Өмнөх"
              disabled={page <= 1}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, page: page - 1 }),
                })
              }
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="adm__iconbtn adm__iconbtn--neutral"
              title="Дараах"
              aria-label="Дараах"
              disabled={page >= totalPages}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, page: page + 1 }),
                })
              }
            >
              <ChevronRightIcon />
            </button>
          </div>
        )}
      </section>
    </>
  )
}
