import type { Mungu } from '~/lib/money'

/**
 * The payment provider seam. Checkout talks to this interface and never to QPay
 * directly, so adding a card processor later means writing a second
 * implementation rather than editing the order flow.
 */

export interface CreateInvoiceInput {
  /** Our order_no. Becomes QPay's sender_invoice_no; must be unique forever. */
  orderNo: string
  /** Mungu. Converted to tugrik at the provider boundary, nowhere else. */
  amount: Mungu
  /** Shown in the bank app. No special characters — QPay rejects them. */
  description: string
  /** Absolute URL QPay POSTs to when payment lands. */
  callbackUrl: string
  customer?: {
    name?: string
    email?: string
    phone?: string
    /** Registration number, if the customer wants an organisation receipt. */
    register?: string
  }
}

/** A bank/wallet app the customer can be deep-linked into on mobile. */
export interface PaymentLink {
  name: string
  description: string
  logo: string
  link: string
}

export interface CreatedInvoice {
  invoiceId: string
  /** Raw EMV QR payload — render this to a QR code ourselves if preferred. */
  qrText: string
  /** Base64 PNG with no data: prefix. Prepend `data:image/png;base64,`. */
  qrImage: string
  /** Short URL covering all banks; handy for SMS. */
  shortUrl: string | null
  links: PaymentLink[]
}

/**
 * What a payment check concluded. Deliberately not the provider's own status
 * string — the order state machine should never branch on a QPay enum.
 */
export type SettlementOutcome =
  /** Enough money arrived. Safe to mark the order paid. */
  | 'paid'
  /** Some money arrived, but less than the total. Needs a human. */
  | 'underpaid'
  /** Nothing has been paid yet. */
  | 'unpaid'
  /** Paid and then reversed. */
  | 'refunded'

export interface SettlementResult {
  outcome: SettlementOutcome
  /** Total confirmed paid, in mungu. */
  paidAmount: Mungu
  /** Provider payment id to store for idempotency. Null when nothing is paid. */
  providerPaymentId: string | null
  /** Untouched provider response, for the payments.raw_callback audit column. */
  raw: unknown
}

export interface PaymentProvider {
  readonly name: string
  createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice>
  /**
   * Independently verify payment. This — not the callback body — is the source
   * of truth. A callback is only ever a hint that it's worth asking.
   */
  checkInvoice(invoiceId: string, expected: Mungu): Promise<SettlementResult>
  cancelInvoice(invoiceId: string): Promise<void>
}
