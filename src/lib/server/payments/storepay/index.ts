import { toStorepayAmount, type Mungu } from '~/lib/money'
import { env } from '~/lib/server/env'
import type {
  CreateInvoiceInput,
  CreatedInvoice,
  PaymentProvider,
  SettlementResult,
} from '../provider'
import { decideStorepaySettlement } from '../settlement'
import { StorepayClient, StorepayError } from './client'
import {
  storepayCancelResponse,
  storepayCheckByLoanResponse,
  storepayCreateLoanResponse,
} from './types'

/** StorePay's own required length for a Mongolian mobile number. */
const MOBILE_LENGTH = 8

/**
 * StorePay implementation of PaymentProvider.
 *
 * StorePay is an installment lender, not a QR-transfer rail like QPay: a
 * "loan" (нэхэмжлэх) is created for the customer's phone number, they confirm
 * it in the StorePay app, and StorePay — not the customer — pays the shop.
 * checkInvoice therefore reports a plain confirmed/not-confirmed state rather
 * than QPay's paid-rows-and-refunds bookkeeping (see decideStorepaySettlement).
 *
 * Phone-number invoices only. StorePay's merchant guide treats "by phone
 * number" and "by QR code" as two separate invoice types; the API doc's
 * "2.1 QR" section is the latter — a JSON payload that, when scanned, has
 * StorePay create its *own* invoice we never get an id for. Showing that QR
 * next to a phone invoice would let a customer confirm the untracked one
 * while the order stays unpaid. The phone invoice alone is enough: it arrives
 * in the customer's StorePay app, and the payment page says so.
 *
 * StorePay rejects invoices under STOREPAY_MIN_TOTAL; checkout enforces that
 * before this is ever called.
 */
export class StorepayProvider implements PaymentProvider {
  readonly name = 'storepay'

  constructor(
    private readonly client: StorepayClient,
    private readonly storeId: string,
  ) {}

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    const mobileNumber = input.customer?.phone
    if (!mobileNumber) {
      throw new Error(
        'StorePay requires the customer’s phone number (mobileNumber)',
      )
    }
    if (mobileNumber.length !== MOBILE_LENGTH) {
      throw new Error(
        `StorePay requires an ${MOBILE_LENGTH}-digit mobile number, got: ${mobileNumber}`,
      )
    }

    const amount = toStorepayAmount(input.amount)
    const description = sanitizeDescription(input.description)

    const raw = await this.client.request<unknown>('/merchant/loan', {
      method: 'POST',
      body: {
        storeId: this.storeId,
        mobileNumber,
        description,
        // Sent as a string: the vendor's own sample requests do, despite the
        // field table calling it Number — matches observed behaviour rather
        // than the (self-contradicting) doc.
        amount: String(amount),
        callbackUrl: input.callbackUrl,
        // Our order number doubles as StorePay's idempotency key, the same
        // role QPay's sender_invoice_no plays.
        requestId: input.orderNo,
      },
    })

    const parsed = storepayCreateLoanResponse.parse(raw)
    if (!parsed.value) {
      throw new StorepayError(
        'StorePay /merchant/loan did not return a loan id',
        200,
        raw,
      )
    }
    return {
      invoiceId: parsed.value,
      // The loan lands in the customer's StorePay app by phone number; there
      // is nothing to scan. Empty strings, not a locally rendered QR — see the
      // class comment for why that QR was actively harmful.
      qrText: '',
      qrImage: '',
      shortUrl: null,
      links: [],
    }
  }

  async checkInvoice(
    invoiceId: string,
    expected: Mungu,
  ): Promise<SettlementResult> {
    const raw = await this.client.request<unknown>(
      `/merchant/loan/check/${encodeURIComponent(invoiceId)}`,
    )

    return decideStorepaySettlement(
      storepayCheckByLoanResponse.parse(raw),
      invoiceId,
      expected,
    )
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    const raw = await this.client.request<unknown>('/merchant/account/cancel', {
      method: 'POST',
      body: { accountId: Number(invoiceId) },
    })
    storepayCancelResponse.parse(raw)
  }
}

/**
 * StorePay puts no character restrictions in its doc (unlike QPay), but a
 * length cap is still cheap insurance against an oversized description.
 */
function sanitizeDescription(description: string): string {
  const trimmed = description.trim().slice(0, 255)
  return trimmed || 'Захиалга'
}

let provider: StorepayProvider | null = null

/**
 * Process-wide singleton, so the cached access token is actually shared.
 *
 * Throws rather than returning a half-usable provider when the STOREPAY_*
 * block is unset — see env.ts. Checkout is expected to keep StorePay out of
 * the payment-method choices it offers until that's configured, so reaching
 * this function at all with nothing set is itself a bug to surface loudly.
 */
export function getStorepayProvider(): StorepayProvider {
  if (!provider) {
    const {
      STOREPAY_BASE_URL,
      STOREPAY_APP_USERNAME,
      STOREPAY_APP_PASSWORD,
      STOREPAY_USERNAME,
      STOREPAY_PASSWORD,
      STOREPAY_STORE_ID,
    } = env

    if (
      !STOREPAY_BASE_URL ||
      !STOREPAY_APP_USERNAME ||
      !STOREPAY_APP_PASSWORD ||
      !STOREPAY_USERNAME ||
      !STOREPAY_PASSWORD ||
      !STOREPAY_STORE_ID
    ) {
      throw new Error(
        'StorePay is not configured — set every STOREPAY_* env var before offering it at checkout',
      )
    }

    provider = new StorepayProvider(
      new StorepayClient({
        baseUrl: STOREPAY_BASE_URL,
        appUsername: STOREPAY_APP_USERNAME,
        appPassword: STOREPAY_APP_PASSWORD,
        username: STOREPAY_USERNAME,
        password: STOREPAY_PASSWORD,
      }),
      STOREPAY_STORE_ID,
    )
  }
  return provider
}

/** Whether checkout should even offer StorePay as an option. */
export function isStorepayConfigured(): boolean {
  return Boolean(
    env.STOREPAY_BASE_URL &&
      env.STOREPAY_APP_USERNAME &&
      env.STOREPAY_APP_PASSWORD &&
      env.STOREPAY_USERNAME &&
      env.STOREPAY_PASSWORD &&
      env.STOREPAY_STORE_ID &&
      env.STOREPAY_CALLBACK_SECRET,
  )
}
