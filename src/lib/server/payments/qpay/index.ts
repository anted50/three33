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
import { qpayInvoiceResponse, qpayPaymentCheckResponse } from './types'

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
