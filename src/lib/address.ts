/**
 * Renders orders.shipping_address_snapshot as one line.
 *
 * Checkout now stores the address as a single free-text block, but orders
 * placed while the form asked for аймаг → сум → хороо separately still hold
 * those fields, so both shapes are joined widest-first the way a courier
 * reads them.
 */
export interface AddressParts {
  address?: string
  province?: string
  district?: string
  khoroo?: string
  line1?: string
  line2?: string | null
}

export function formatAddress(parts: AddressParts): string {
  if (parts.address) return parts.address

  return [
    parts.province,
    parts.district,
    parts.khoroo,
    parts.line1,
    parts.line2,
  ]
    .filter(Boolean)
    .join(', ')
}
