import type { OrderStatus } from '~/db/schema'

/** Mongolian labels for the order state machine, in one place. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Төлбөр хүлээж буй',
  paid: 'Төлөгдсөн',
  processing: 'Бэлтгэж буй',
  shipped: 'Илгээсэн',
  delivered: 'Хүргэгдсэн',
  cancelled: 'Цуцлагдсан',
  expired: 'Хугацаа дууссан',
  refunded: 'Буцаагдсан',
}

/** Visual weight follows what needs attention, not the enum order. */
const TONE: Record<OrderStatus, string> = {
  pending_payment: 'wait',
  paid: 'done',
  processing: 'ok',
  shipped: 'ok',
  delivered: 'blue',
  cancelled: 'dead',
  expired: 'dead',
  refunded: 'warn',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className="badge2" data-tone={TONE[status]}>
      {STATUS_LABEL[status]}
    </span>
  )
}
