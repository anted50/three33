import { createFileRoute } from '@tanstack/react-router'
import { bookingReadLimit } from '~/lib/server/api/rate-limit'
import { handle } from '~/lib/server/api/respond'
import { bookingOptions } from '~/lib/server/booking/public'

/**
 * GET /api/v1/public/booking-options — step 1 of booking: pick a service
 *
 * Auth   none; rate-limited per IP (bookingReadLimit)
 * 200    { bookingFee,      mungu, paid online to confirm; null = booking off
 *          services: [{ id, name, description, durationMinutes, price }] }
 *                           active only, in display order; price is paid at
 *                           the shop (null = not shown)
 */
export const Route = createFileRoute('/api/v1/public/booking-options')({
  server: {
    middleware: [bookingReadLimit],
    handlers: {
      GET: () => handle(() => bookingOptions()),
    },
  },
})
