import QRCode from 'qrcode'
import { toQpayAmount, type Mungu } from '~/lib/money'
import { env } from '~/lib/server/env'
import type {
  CreateInvoiceInput,
  CreatedInvoice,
  PaymentProvider,
  SettlementResult,
} from '../provider'
import { decideSettlement } from '../settlement'
import { QpayClient, sanitizeDescription } from './client'
import {
  qpayEbarimtResponse,
  qpayInvoiceResponse,
  qpayPaymentCheckResponse,
} from './types'

export interface EbarimtReceipt {
  id: string | null
  /** Raw QR payload/URL QPay returned, if any — kept for a "view" link even
   * when it is not itself an image. */
  qrData: string | null
  /** Base64 PNG, no `data:` prefix — same convention as CreatedInvoice.qrImage.
   * Either passed through from QPay or rendered locally from qrData; null only
   * when there was nothing to turn into a QR at all. */
  qrImage: string | null
  lottery: string | null
}

/** Renders a base64 PNG (no `data:` prefix) from arbitrary QR text, for the
 * case where QPay hands back a payload but not a pre-rendered image. */
async function renderQr(data: string): Promise<string | null> {
  try {
    const dataUrl = await QRCode.toDataURL(data, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
    })
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } catch (error) {
    console.error('Failed to render e-barimt QR locally:', error)
    return null
  }
}

/**
 * QPay implementation of PaymentProvider.
 *
 * Amount conversion (mungu -> tugrik) happens here and only here; everything
 * upstream of this file speaks mungu.
 */
export class QpayProvider implements PaymentProvider {
  readonly name = 'qpay'

  constructor(private readonly client: QpayClient) {}

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    const body = {
      invoice_code: env.QPAY_INVOICE_CODE,
      sender_invoice_no: input.orderNo,
      // Required by QPay. We have one storefront, so a constant is honest;
      // a per-customer code here would leak nothing useful and complicate
      // reconciliation in the merchant portal.
      invoice_receiver_code: 'terminal',
      invoice_description: sanitizeDescription(input.description),
      amount: toQpayAmount(input.amount),
      callback_url: input.callbackUrl,
      sender_staff_code: 'online',
      ...(input.customer
        ? {
            invoice_receiver_data: {
              register: input.customer.register,
              name: input.customer.name,
              email: input.customer.email,
              phone: input.customer.phone,
            },
          }
        : {}),
    }

    const raw = await this.client.request<unknown>('/invoice', {
      method: 'POST',
      body,
    })

    const parsed = qpayInvoiceResponse.parse(raw)

    return {
      invoiceId: parsed.invoice_id,
      qrText: parsed.qr_text,
      qrImage: parsed.qr_image,
      shortUrl: parsed.qPay_shortUrl ?? null,
      // The spec names this field both ways in the same document; accept either.
      links: parsed.urls ?? parsed.qPay_deeplink ?? [],
    }
  }

  async checkInvoice(
    invoiceId: string,
    expected: Mungu,
  ): Promise<SettlementResult> {
    const raw = await this.client.request<unknown>('/payment/check', {
      method: 'POST',
      body: {
        object_type: 'INVOICE',
        object_id: invoiceId,
        offset: { page_number: 1, page_limit: 100 },
      },
    })

    return decideSettlement(qpayPaymentCheckResponse.parse(raw), expected)
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    await this.client.request(`/invoice/${encodeURIComponent(invoiceId)}`, {
      method: 'DELETE',
    })
  }

  /**
   * Requests a real e-barimt for a settled payment.
   *
   * Not part of the PaymentProvider interface — e-barimt is a Mongolian tax
   * requirement specific to this provider, not a concept a card processor
   * would share, so it stays on the concrete class rather than leaking into
   * the generic abstraction.
   *
   * Returns null, never throws, when QPAY_EBARIMT_INVOICE_CODE is unset or the
   * call fails — callers treat "no e-barimt" as a normal outcome (the order
   * receipt still emails without it) rather than an error to propagate into a
   * payment-settlement path.
   */
  async createEbarimt(
    paymentId: string,
    ebarimtInvoiceCode: string | undefined,
  ): Promise<EbarimtReceipt | null> {
    if (!ebarimtInvoiceCode) return null

    try {
      const raw = await this.client.request<unknown>('/ebarimt/create', {
        method: 'POST',
        body: {
          payment_id: paymentId,
          ebarimt_receiver_type: 'CITIZEN',
          invoice_code: ebarimtInvoiceCode,
        },
      })

      const parsed = qpayEbarimtResponse.parse(raw)
      const qrData = parsed.ebarimt_qr_data ?? parsed.qr_data ?? null
      const readyImage = parsed.ebarimt_qr_image ?? parsed.qr_image ?? null
      if (!qrData && !readyImage) return null

      return {
        id: parsed.id ?? null,
        qrData,
        qrImage: readyImage ?? (qrData ? await renderQr(qrData) : null),
        lottery: parsed.ebarimt_lottery ?? parsed.lottery ?? null,
      }
    } catch (error) {
      console.error(
        `QPay /ebarimt/create failed for payment ${paymentId}:`,
        error,
      )
      return null
    }
  }
}

let provider: QpayProvider | null = null

/** Process-wide singleton, so the cached access token is actually shared. */
export function getQpayProvider(): QpayProvider {
  provider ??= new QpayProvider(
    new QpayClient({
      baseUrl: env.QPAY_BASE_URL,
      username: env.QPAY_USERNAME,
      password: env.QPAY_PASSWORD,
    }),
  )
  return provider
}
