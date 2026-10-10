import { tugrikToMungu, type Mungu } from './money'
import type { ProviderName } from './server/payments/registry'

/**
 * What an admin invoice can be paid with: any provider, or `manual` — money
 * taken outside them at the counter (the shop's own card reader, cash). A
 * manual sale is recorded as paid the moment it's created; no provider is
 * ever asked about it, so it never becomes a ProviderName.
 */
export type InvoiceMethod = ProviderName | 'manual'

/** Display copy shared between the checkout form and the payment page, so the
 * two never drift on what to call each option. */
export const PAYMENT_METHOD_LABELS: Record<InvoiceMethod, string> = {
  qpay: 'QPay',
  storepay: 'StorePay',
  manual: 'Бусад',
}

/** Brand mark shown next to the method's label. */
export const PAYMENT_METHOD_LOGOS: Record<InvoiceMethod, string> = {
  qpay: '/payments/qpay/symbol.png',
  storepay: '/payments/storepay/symbol-dark-blue.png',
  manual: '/payments/manual.svg',
}

/**
 * Smallest order total a method will accept. StorePay's merchant guide:
 * "Нэхэмжлэх дүн 100,000 төгрөгөөс дээш байх шаардлагатай". Its own sample
 * invoices are exactly 100,000₮, so the bound is inclusive.
 *
 * Lives here, not server-side only, because the checkout drawer needs it to
 * grey the option out before the customer ever hits submit.
 */
export const PAYMENT_METHOD_MIN_TOTAL: Partial<Record<InvoiceMethod, Mungu>> = {
  storepay: tugrikToMungu(100_000),
}

export function meetsMinimum(method: InvoiceMethod, total: Mungu): boolean {
  const min = PAYMENT_METHOD_MIN_TOTAL[method]
  return min === undefined || total >= min
}
