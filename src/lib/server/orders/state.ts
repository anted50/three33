import type { OrderStatus } from '~/db/schema'

/**
 * The order state machine. Pure, so the rules are readable in one place and
 * testable without a database.
 *
 * The database does not enforce these — Postgres only knows the enum. Every
 * status write goes through assertTransition.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // The QPay outcome, or the reconciliation sweep, decides which way this goes.
  pending_payment: ['paid', 'cancelled', 'expired'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  // Terminal-ish: a delivered order can still be refunded, nothing else.
  delivered: ['refunded'],
  cancelled: [],
  expired: [],
  refunded: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Cannot move an order from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}

/** Statuses where the customer's money is ours and stock is committed. */
export function isPaid(status: OrderStatus): boolean {
  return (
    status === 'paid' ||
    status === 'processing' ||
    status === 'shipped' ||
    status === 'delivered'
  )
}

/** Nothing further will happen to these without a human. */
export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** Only delivered orders may be reviewed. */
export function canReview(status: OrderStatus): boolean {
  return status === 'delivered'
}
