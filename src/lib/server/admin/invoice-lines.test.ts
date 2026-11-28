import { describe, expect, it } from 'vitest'
import { tugrikToMungu } from '~/lib/money'
import { createAdminInvoiceInput, INVOICE_LINES_MAX, invoiceTotal } from './invoice-lines'

const VARIANT = '0b6e3c9e-5c1a-4f3e-9a51-2d9f0c7e8a11'

describe('invoiceTotal', () => {
  it('sums qty × unit price across lines', () => {
    expect(
      invoiceTotal([
        { qty: 2, unitPrice: tugrikToMungu(45_000) },
        { qty: 1, unitPrice: tugrikToMungu(10_000) },
      ]),
    ).toBe(tugrikToMungu(100_000))
  })

  it('refuses an empty invoice, which createAdminInvoiceInput never lets through', () => {
    expect(() => invoiceTotal([])).toThrow()
  })
})

describe('createAdminInvoiceInput', () => {
  const custom = {
    kind: 'custom' as const,
    name: 'Үсчин',
    qty: 1,
    unitPrice: tugrikToMungu(30_000),
  }

  it('accepts a QPay invoice with no phone', () => {
    expect(
      createAdminInvoiceInput.safeParse({ method: 'qpay', lines: [custom] }).success,
    ).toBe(true)
  })

  it('requires a phone for StorePay, which sends the invoice to it', () => {
    const result = createAdminInvoiceInput.safeParse({
      method: 'storepay',
      lines: [custom],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a manual (card reader) sale with no phone', () => {
    expect(
      createAdminInvoiceInput.safeParse({ method: 'manual', lines: [custom] }).success,
    ).toBe(true)
  })

  it('rejects a method that does not exist', () => {
    expect(
      createAdminInvoiceInput.safeParse({ method: 'cash', lines: [custom] }).success,
    ).toBe(false)
  })

  it('rejects the same variant on two rows', () => {
    const line = { kind: 'variant' as const, variantId: VARIANT, qty: 1, unitPrice: 0 }
    const result = createAdminInvoiceInput.safeParse({
      method: 'qpay',
      lines: [line, { ...line, qty: 2 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a sub-tugrik price, which neither provider accepts', () => {
    const result = createAdminInvoiceInput.safeParse({
      method: 'qpay',
      lines: [{ ...custom, unitPrice: 12_345 }],
    })
    expect(result.success).toBe(false)
  })

  it('names an unnamed custom line Үйлчилгээ', () => {
    for (const name of [undefined, '', '   ']) {
      const result = createAdminInvoiceInput.parse({
        method: 'qpay',
        lines: [{ ...custom, name }],
      })
      const [line] = result.lines
      expect(line?.kind === 'custom' && line.name).toBe('Үйлчилгээ')
    }
  })

  // The boundary on both sides: the cap itself passes, one more line does not.
  it('accepts INVOICE_LINES_MAX lines and rejects one more', () => {
    const lines = Array.from({ length: INVOICE_LINES_MAX }, () => custom)
    expect(createAdminInvoiceInput.safeParse({ method: 'qpay', lines }).success).toBe(true)
    expect(
      createAdminInvoiceInput.safeParse({ method: 'qpay', lines: [...lines, custom] }).success,
    ).toBe(false)
  })

  it('rejects an invoice with no lines', () => {
    expect(
      createAdminInvoiceInput.safeParse({ method: 'qpay', lines: [] }).success,
    ).toBe(false)
  })
})
