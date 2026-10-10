import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { ownerOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getAnySale } from '~/lib/server/booking/oversight'

/**
 * GET /api/v1/owner/sales/{saleId} — any barber's sale in full
 *
 * Auth   owner (ownerOnly)
 * 200    Sale — { …, lines, payments, due, paid, pending, remaining }
 *        product lines carry skuSnapshot; service/custom lines don't
 * 404    NOT_FOUND
 */
export const Route = createFileRoute('/api/v1/owner/sales/$saleId')({
  server: {
    middleware: [ownerOnly],
    handlers: {
      GET: ({ params }) => handle(() => getAnySale(readId(params, 'saleId'))),
    },
  },
})
