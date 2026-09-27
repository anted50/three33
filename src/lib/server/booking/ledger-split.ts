import type { PaymentMethod } from '~/db/schema'

/**
 * The barber_ledger rows one paid payment creates. Pure: unit tested.
 *
 * Balance convention: positive = the shop owes the barber.
 *
 *   service_share   the barber's part of the payment: amount − shop cut
 *   cash_collected  − the whole amount, when paid in cash: the barber is
 *                   holding the shop's money and owes it back
 *
 * QPay, POS and bank transfer land in the shop's main account, so they only
 * create the share. The shop's cut is rounded DOWN to the mungu, so any
 * rounding goes the barber's way.
 */
export interface LedgerLine {
  kind: 'service_share' | 'cash_collected'
  grossAmount: number
  rateBps: number | null
  amount: number
}

export function splitPayment(
  method: PaymentMethod,
  amount: number,
  serviceCutBps: number,
): LedgerLine[] {
  const shopCut = Math.floor((amount * serviceCutBps) / 10_000)
  const lines: LedgerLine[] = [
    {
      kind: 'service_share',
      grossAmount: amount,
      rateBps: serviceCutBps,
      amount: amount - shopCut,
    },
  ]
  if (method === 'cash') {
    lines.push({ kind: 'cash_collected', grossAmount: amount, rateBps: null, amount: -amount })
  }
  return lines
}
