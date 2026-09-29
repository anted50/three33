import { z } from 'zod'
import { lineTotal, MUNGU_PER_TUGRIK, sumMungu, type Mungu } from '~/lib/money'

/**
 * The shape of an admin invoice, and its arithmetic. No database here, so the
 * rules are testable on their own — see invoice-lines.test.ts.
 */

/** What a custom line is called when the admin doesn't bother to name it. */
export const DEFAULT_CUSTOM_LINE_NAME = 'Үйлчилгээ'

/** Mungu, whole tugrik only: both providers reject a sub-tugrik amount. */
const unitPrice = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000)
  .refine((v) => v % MUNGU_PER_TUGRIK === 0, 'Үнэ бүхэл төгрөг байх ёстой')

const qty = z.number().int().min(1).max(10_000)

export const invoiceLineInput = z.discriminatedUnion('kind', [
  /** A catalog variant. Stock is deducted when the invoice is paid. */
  z.object({
    kind: z.literal('variant'),
    variantId: z.uuid(),
    qty,
    /** Prefilled with the catalog price; the admin may discount it. */
    unitPrice,
  }),
  /** Free-form: a service, a delivery charge, a round amount. No stock. */
  z.object({
    kind: z.literal('custom'),
    name: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((name) => name || DEFAULT_CUSTOM_LINE_NAME),
    qty,
    unitPrice,
  }),
])
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>

export const createAdminInvoiceInput = z
  .object({
    method: z.enum(['qpay', 'storepay']),
    /** Required for StorePay (the invoice is sent to it), optional for QPay. */
    phone: z
      .string()
      .trim()
      .regex(/^\d{8}$/, 'Утасны дугаар 8 оронтой байх ёстой')
      .optional()
      .or(z.literal('')),
    /** Where the receipt goes once paid. */
    email: z.email().max(255).optional().or(z.literal('')),
    name: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
    lines: z.array(invoiceLineInput).min(1, 'Дор хаяж нэг мөр нэмнэ үү').max(100),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'storepay' && !data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'StorePay-ээр нэхэмжлэхэд хэрэглэгчийн утасны дугаар шаардлагатай',
      })
    }

    // One row per variant: two rows for the same item would be checked against
    // stock separately and could each pass while their sum does not.
    const variantIds = data.lines.flatMap((line) =>
      line.kind === 'variant' ? [line.variantId] : [],
    )
    if (new Set(variantIds).size !== variantIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Нэг барааг хоёр мөрөнд оруулсан байна',
      })
    }
  })
export type CreateAdminInvoiceInput = z.infer<typeof createAdminInvoiceInput>

export function invoiceTotal(
  lines: ReadonlyArray<{ qty: number; unitPrice: Mungu }>,
): Mungu {
  return sumMungu(lines.map((line) => lineTotal(line.unitPrice, line.qty)))
}
