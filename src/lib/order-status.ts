import type { OrderStatus } from '~/db/schema'

/**
 * Mongolian labels for the order state machine, in one place — shared by the
 * status badge (client) and the Excel export (server), so the two can't drift.
 */
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
