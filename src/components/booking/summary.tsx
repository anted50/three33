import type { ReactNode } from 'react'
import { dayOfMonth, localDateOf, monthLabel, slotTime, weekdayShort } from '~/lib/booking/calendar'
import { formatMnt } from '~/lib/money'

/** The black date tile: "10-р сар / 29". Empty until a time is picked. */
export function DateTile({ startsAt }: { startsAt: string | null }) {
  if (!startsAt) {
    return (
      <span className="bk-date" data-empty="true">
        <small>—</small>
        <b>—</b>
      </span>
    )
  }
  const date = localDateOf(new Date(startsAt))
  return (
    <span className="bk-date">
      <small>{monthLabel(date)}</small>
      <b>{dayOfMonth(date)}</b>
    </span>
  )
}

/** "Пү · 14:30 — 15:15" */
export function whenLine(startsAt: string, endsAt: string): string {
  return `${weekdayShort(localDateOf(new Date(startsAt)))} · ${slotTime(startsAt)} — ${slotTime(endsAt)}`
}

/**
 * Desktop's right-hand column: what's being booked, what's paid now and what
 * at the shop, then the bar. Phones get the bar alone (fixed to the bottom)
 * and a compact version of the card in the flow where it's needed.
 */
export function SummaryCard({
  service,
  startsAt,
  endsAt,
  price,
  fee,
  children,
  note,
}: {
  service: string | null
  startsAt: string | null
  endsAt: string | null
  price: number | null
  fee: number
  children: ReactNode
  note?: ReactNode
}) {
  return (
    <aside className="bk-side">
      <div className="bk-card bk-side__card">
        <div className="bk-row">
          <DateTile startsAt={startsAt} />
          <div>
            <div className="bk-row__v">{startsAt && endsAt ? whenLine(startsAt, endsAt) : 'Цаг сонгоогүй'}</div>
            <div className="bk-row__k">{service ?? 'Үйлчилгээ сонгоогүй'}</div>
          </div>
        </div>
        {price !== null && (
          <div className="bk-row bk-row--split">
            <span className="bk-muted">Газар дээр</span>
            <span className="bk-row__v">{formatMnt(price)}</span>
          </div>
        )}
        <div className="bk-row bk-row--split">
          <span className="bk-muted">Одоо төлөх урьдчилгаа</span>
          <span className="bk-row__v bk-row__v--big">{formatMnt(fee)}</span>
        </div>
      </div>
      {children}
      <p className="bk-fine bk-side__note">{note ?? `${formatMnt(fee)} урьдчилгаа буцаагдахгүй. Үйлчилгээний үнийг газар дээр нь төлнө.`}</p>
    </aside>
  )
}
