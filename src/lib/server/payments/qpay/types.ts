import { z } from 'zod'

/**
 * Response shapes from the QPay V2 merchant API, per the vendor spreadsheet
 * (2025.06.10 V2 API with Ebarimt 3.0) and Postman collection.
 *
 * These are permissive on purpose: QPay sends numbers as strings in places
 * ("100.00" for amounts) and adds fields between revisions. We coerce what we
 * need and ignore the rest rather than 400-ing on an unexpected extra key.
 */

export const qpayTokenResponse = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string().optional(),
  /**
   * NOT a duration. QPay returns a UNIX timestamp (seconds) for the moment the
   * token dies — the field name is a lie and treating it as "seconds from now"
   * yields a token that appears valid for ~52 years.
   */
  expires_in: z.coerce.number(),
  refresh_expires_in: z.coerce.number().optional(),
})
export type QpayTokenResponse = z.infer<typeof qpayTokenResponse>

const qpayLink = z.object({
  name: z.string(),
  description: z.string().default(''),
  logo: z.string().default(''),
  link: z.string(),
})

export const qpayInvoiceResponse = z.object({
  invoice_id: z.string(),
  qr_text: z.string(),
  qr_image: z.string(),
  qPay_shortUrl: z.string().nullish(),
  /**
   * The spec's field table calls this `qPay_deeplink`; the actual JSON uses
   * `urls`. Accept either — the sample responses in the same document disagree
   * with each other.
   */
  urls: z.array(qpayLink).nullish(),
  qPay_deeplink: z.array(qpayLink).nullish(),
})
export type QpayInvoiceResponse = z.infer<typeof qpayInvoiceResponse>

/** NEW: created · FAILED · PAID · PARTIAL: underpaid · REFUNDED: reversed. */
export const qpayPaymentStatus = z.enum([
  'NEW',
  'FAILED',
  'PAID',
  'PARTIAL',
  'REFUNDED',
])
export type QpayPaymentStatus = z.infer<typeof qpayPaymentStatus>

export const qpayPaymentRow = z.object({
  /** May be a long numeric string or a UUID depending on payment type. */
  payment_id: z.coerce.string(),
  payment_status: qpayPaymentStatus.catch('NEW'),
  /** Tugrik, sometimes as a string like "100.00". */
  payment_amount: z.coerce.number(),
  payment_currency: z.string().nullish(),
  payment_wallet: z.string().nullish(),
  payment_type: z.string().nullish(),
  payment_date: z.string().nullish(),
})
export type QpayPaymentRow = z.infer<typeof qpayPaymentRow>

export const qpayPaymentCheckResponse = z.object({
  count: z.coerce.number().default(0),
  paid_amount: z.coerce.number().default(0),
  rows: z.array(qpayPaymentRow).default([]),
})
export type QpayPaymentCheckResponse = z.infer<typeof qpayPaymentCheckResponse>

/** QPay error bodies look like { error, message }. */
export const qpayErrorResponse = z.object({
  error: z.string().nullish(),
  message: z.string().nullish(),
})

/**
 * What QPay POSTs to our callback URL. Notably thin — which is exactly why the
 * callback is treated as a notification and never as proof of payment.
 */
export const qpayCallbackBody = z
  .object({
    payment_id: z.coerce.string().nullish(),
    payment_status: z.string().nullish(),
    object_id: z.string().nullish(),
  })
  .passthrough()
export type QpayCallbackBody = z.infer<typeof qpayCallbackBody>
