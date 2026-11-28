import { createFileRoute } from '@tanstack/react-router'
import { readQuery } from '~/lib/server/api/input'
import { bookingReadLimit } from '~/lib/server/api/rate-limit'
import { handle } from '~/lib/server/api/respond'
import { availableSlots, slotsQuery } from '~/lib/server/booking/public'

/**
 * GET /api/v1/public/slots?serviceId=&from=YYYY-MM-DD&days=14 — step 2: pick a time
 *
 * Free start times for the service, day by day (Ulaanbaatar days). A day the
 * barber hasn't opened has an empty `slots`.
 *
 * Auth   none; rate-limited per IP (bookingReadLimit)
 * 200    { service: { id, name, durationMinutes },
 *          days: [{ date, slots: [ISO start, …] }] }
 * 404    unknown or inactive service
 * 429    RATE_LIMITED       too many requests from this IP; wait a minute
 */
export const Route = createFileRoute('/api/v1/public/slots')({
  server: {
    middleware: [bookingReadLimit],
    handlers: {
      GET: ({ request }) => handle(() => availableSlots(readQuery(request, slotsQuery))),
    },
  },
})
