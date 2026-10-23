import { createFileRoute } from '@tanstack/react-router'
import { handle } from '~/lib/server/api/respond'
import { bookingOptions } from '~/lib/server/booking/public'

/**
 * GET /api/v1/public/booking-options — step 1 of booking: pick a service
 *
 * Auth   none
 * 200    { bookingFee,      mungu, paid online to confirm; null = booking off
 *          services: [{ id, name, description, durationMinutes, price }] }
 *                           active only, in display order; price is paid at
 *                           the shop (null = not shown)
 */
export const Route = createFileRoute('/api/v1/public/booking-options')({
  server: {
    handlers: {
      GET: () => handle(() => bookingOptions()),
    },
  },
})
