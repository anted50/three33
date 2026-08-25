import type { OrderStatus } from '~/db/schema'
import { STATUS_LABEL } from '~/lib/order-status'

export { STATUS_LABEL }

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
