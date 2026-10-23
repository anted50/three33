import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { readBody } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { loadBookingFee, saveBookingFee } from '~/lib/server/settings'

/**
 * GET /api/v1/admin/booking-fee — { bookingFee }   null = online booking off
 * PUT /api/v1/admin/booking-fee — { bookingFee }   mungu, at least 1₮
 *
 * What customers pay through QPay to confirm a booking. A change applies to
 * new bookings; existing ones keep the fee they paid.
 *
 * Auth   admin (adminOnly)
 * 200    { bookingFee }
 */
const feeInput = z.object({ bookingFee: z.number().int().min(100).max(1_000_000_000_00).multipleOf(100) })

export const Route = createFileRoute('/api/v1/admin/booking-fee')({
  server: {
    middleware: [adminOnly],
    handlers: {
      GET: () => handle(async () => ({ bookingFee: await loadBookingFee() })),
      PUT: ({ request }) =>
        handle(async () => {
          const { bookingFee } = await readBody(request, feeInput)
          await saveBookingFee(bookingFee)
          return { bookingFee }
        }),
    },
  },
})
