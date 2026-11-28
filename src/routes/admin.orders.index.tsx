import { useRef, useState } from 'react'
import { formatDate } from '~/lib/dates'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { assert } from '~/lib/assert'
import { formatAddress } from '~/lib/address'
import { formatMnt } from '~/lib/money'
import { exportOrders, getOrders } from '~/lib/server/admin/admin'
import { STATUS_LABEL, StatusBadge } from '~/components/admin-bits'
import { ChevronLeftIcon, ChevronRightIcon } from '~/components/admin-icons'
import { ScrollTrack } from '~/components/scroll-track'

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
 * cancelled and expired checkouts — those two rail items are how you reach them.
 * Unpaid checkouts aren't listed at all, so they get no entry.
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

  return (
    <>
      <header className="adm__head">
        <h1>Захиалга</h1>
      </header>

      {/*
        Status filters as tabs over the list, like a browser's: the open one
        joins the page under it, so the filter reads as "which list this is".
        A left rail here stood a second sidebar beside the section nav.
      */}
      <div className="adm__tabbed">
        <StatusTabs active={status ?? 'all'} />

        <div className="adm__tabpanel">
          <OrdersToolbar status={status} dateFrom={dateFrom} dateTo={dateTo} />

          <section className="adm__card">
            {rows.length === 0 ? (
              <p className="adm__muted adm__pad">Тохирох захиалга алга.</p>
            ) : (
              <OrdersTable rows={rows} />
            )}

            {total > 0 && (
              <Pager page={page} total={total} pageSize={pageSize} />
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function StatusTabs({ active }: { active: string }) {
  const tabsRef = useRef<HTMLElement>(null)

  return (
    /* Where the tabs run past the edge (a phone, a narrow window), the
       track under them shows there is more and how far along you are. */
    <div className="adm__tabswrap">
      <nav className="adm__tabs" aria-label="Төлөв" ref={tabsRef}>
        {FILTERS.map((filter) => (
          <Link
            key={filter}
            to="/admin/orders"
            search={(prev) => ({
              ...prev,
              status: filter === 'all' ? undefined : filter,
              page: undefined,
            })}
            className="adm__tab"
            data-active={active === filter}
            aria-current={active === filter ? 'page' : undefined}
          >
            {filter === 'all' ? 'Бүгд' : STATUS_LABEL[filter]}
          </Link>
        ))}
      </nav>
      <ScrollTrack target={tabsRef} />
    </div>
  )
}

function OrdersToolbar({
  status,
  dateFrom,
  dateTo,
}: {
  status: string | undefined
  dateFrom: string | undefined
  dateTo: string | undefined
}) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const { filename, base64 } = await exportOrders({
        data: { status, dateFrom, dateTo },
      })
      downloadSpreadsheet(filename, base64)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Экспортод алдаа гарлаа')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="adm__toolbar adm__toolbar--oneline">
        <DateRange dateFrom={dateFrom} dateTo={dateTo} />

        {/* "Excel" alone on a phone, so it fits on the dates' row. */}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={exporting}
          aria-busy={exporting}
          aria-label={exporting ? 'Бэлтгэж байна…' : 'Excel татах'}
          onClick={handleExport}
        >
          <span className="adm__onwide">
            {exporting ? 'Бэлтгэж байна…' : 'Excel татах'}
          </span>
          <span className="adm__onphone">
            {exporting ? 'Excel…' : 'Excel'}
          </span>
        </button>
      </div>

      {exportError && <p className="error">{exportError}</p>}
    </>
  )
}

/** Hands the export's bytes to the browser as a file download. */
function downloadSpreadsheet(filename: string, base64: string) {
  assert(filename.endsWith('.xlsx'), 'downloadSpreadsheet: not an .xlsx file')
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function DateRange({
  dateFrom,
  dateTo,
}: {
  dateFrom: string | undefined
  dateTo: string | undefined
}) {
  const navigate = useNavigate({ from: Route.fullPath })

  /** Any change to the range starts the list over at its first page. */
  function setRange(range: { dateFrom?: string; dateTo?: string }) {
    void navigate({
      search: (prev) => ({ ...prev, ...range, page: undefined }),
    })
  }

  return (
    <div className="adm__daterange">
      <label className="field">
        <span>Эхлэх огноо</span>
        <input
          type="date"
          value={dateFrom ?? ''}
          max={dateTo}
          onChange={(e) => setRange({ dateFrom: e.target.value || undefined })}
        />
      </label>

      <label className="field">
        <span>Дуусах огноо</span>
        <input
          type="date"
          value={dateTo ?? ''}
          min={dateFrom}
          onChange={(e) => setRange({ dateTo: e.target.value || undefined })}
        />
      </label>

      {(dateFrom || dateTo) && (
        <button
          type="button"
          className="linkish"
          onClick={() => setRange({ dateFrom: undefined, dateTo: undefined })}
        >
          Огноо цэвэрлэх
        </button>
      )}
    </div>
  )
}

type OrderRow = Awaited<ReturnType<typeof getOrders>>['rows'][number]

function OrdersTable({ rows }: { rows: OrderRow[] }) {
  return (
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
            <td className="adm__muted">{formatDate(order.createdAt)}</td>
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
  )
}

function Pager({
  page,
  total,
  pageSize,
}: {
  page: number
  total: number
  pageSize: number
}) {
  const navigate = useNavigate({ from: Route.fullPath })
  assert(pageSize > 0, 'Pager: page size must be positive')
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function goToPage(target: number) {
    void navigate({ search: (prev) => ({ ...prev, page: target }) })
  }

  return (
    <div className="adm__pager">
      <span className="adm__muted">
        {page} / {pageCount} ({total})
      </span>
      <button
        type="button"
        className="adm__iconbtn adm__iconbtn--neutral"
        title="Өмнөх"
        aria-label="Өмнөх"
        disabled={page <= 1}
        onClick={() => goToPage(page - 1)}
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        className="adm__iconbtn adm__iconbtn--neutral"
        title="Дараах"
        aria-label="Дараах"
        disabled={page >= pageCount}
        onClick={() => goToPage(page + 1)}
      >
        <ChevronRightIcon />
      </button>
    </div>
  )
}
