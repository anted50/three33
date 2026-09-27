import type { PaymentMethod } from '~/db/schema'

/**
 * The barber_ledger rows one paid POS payment creates. Pure: unit tested.
 *
 * Balance convention: positive = the shop owes the barber.
 *
 *   service_share       the barber's part of the service money: amount − shop cut
 *   product_commission  the barber's cut of product money (products are the
 *                       shop's; the barber earns commission on selling them)
 *   cash_collected      − the whole payment, when paid in cash: the barber is
 *                       holding the shop's money and owes it back
 *
 * QPay, POS and bank transfer land in the shop's main account, so they only
 * create the barber's part. Rounding always goes the barber's way: the shop
 * cut is rounded down, the commission up.
 */
export interface LedgerLine {
  kind: 'service_share' | 'product_commission' | 'cash_collected'
  grossAmount: number
  rateBps: number | null
  amount: number
}

export interface Parts {
  service: number
  product: number
}

/**
 * Which part of a payment pays for products and which for services, in a
 * sale that has both. Products are covered first, so a sale's payments add
 * up to exactly its product total and service total — no rounding drift
 * across split payments.
 *
 *   productDue  the product lines' total
 *   paidBefore  what earlier paid payments of the same sale already covered
 */
export function allocate(amount: number, productDue: number, paidBefore: number): Parts {
  const productLeft = Math.max(0, productDue - paidBefore)
  const product = Math.min(amount, productLeft)
  return { product, service: amount - product }
}

export function splitPayment(
  method: PaymentMethod,
  parts: Parts,
  rates: { serviceCutBps: number; productCommissionBps: number },
): LedgerLine[] {
  const lines: LedgerLine[] = []

  if (parts.service > 0) {
    const shopCut = Math.floor((parts.service * rates.serviceCutBps) / 10_000)
    lines.push({ kind: 'service_share', grossAmount: parts.service, rateBps: rates.serviceCutBps, amount: parts.service - shopCut })
  }
  if (parts.product > 0 && rates.productCommissionBps > 0) {
    const commission = Math.ceil((parts.product * rates.productCommissionBps) / 10_000)
    lines.push({ kind: 'product_commission', grossAmount: parts.product, rateBps: rates.productCommissionBps, amount: commission })
  }
  const total = parts.service + parts.product
  if (method === 'cash' && total > 0) {
    lines.push({ kind: 'cash_collected', grossAmount: total, rateBps: null, amount: -total })
  }
  return lines
}
