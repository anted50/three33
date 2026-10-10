import { createFileRoute } from '@tanstack/react-router'
import { readQuery } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { productsQuery, sellableProducts } from '~/lib/server/booking/products'

/**
 * GET /api/v1/barber/products — the catalog for the POS
 *
 * Active products with their active variants, the owner's listed price and
 * current stock. Add one to a sale as a product line: { variantId, qty }.
 * Read-only: prices and stock are the owner's.
 *
 * Auth   barber (barberOnly)
 * Query  q?  matches name (EN/MN), sku or brand line
 * 200    [{ productId, nameEn, nameMn, brandLine,
 *           variants: [{ id, sku, size, price, stockQty }] }]
 */
export const Route = createFileRoute('/api/v1/barber/products')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ request }) => handle(() => sellableProducts(readQuery(request, productsQuery))),
    },
  },
})
