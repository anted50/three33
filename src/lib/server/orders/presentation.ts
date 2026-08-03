import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { orders, payments } from '~/db/schema'
import type { PaymentLink } from '../payments/provider'
import { orderNoInput } from './queries'

export interface InvoicePresentation {
  qrText: string
  qrImage: string
  shortUrl: string | null
  links: PaymentLink[]
}

/**
 * Everything the payment page needs to render, read from the row written at
 * invoice creation rather than re-fetched from QPay.
 *
 * A customer refreshing the payment page, or coming back to it from a bank app,
 * must not cost an API call each time — and QPay's own guidance is to be sparing
 * with their endpoints.
 */
export const getInvoicePresentation = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }): Promise<InvoicePresentation | null> => {
    const [row] = await db
      .select({ payload: payments.invoicePayload })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(orders.orderNo, data.orderNo))
      .limit(1)

    if (!row?.payload) return null
    return row.payload as InvoicePresentation
  })
