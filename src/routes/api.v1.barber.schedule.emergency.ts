import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { clearPeriod, emergencyInput } from '~/lib/server/booking/appointments/emergency'

/**
 * POST /api/v1/barber/schedule/emergency — "I can't work these days"
 *
 * Every day from `from` to `to` becomes a day off (no new online bookings)
 * and every booking in the period is flagged for rescheduling. Nothing is
 * cancelled or moved: call each customer on the returned list, then
 * /reschedule (clears the flag, keeps the fee) or /cancel. The list stays
 * available at GET /barber/appointments?needsReschedule=true until empty.
 *
 * Auth   barber (barberOnly)
 * Body   { "from": "2026-10-06", "to": "2026-10-08", "note"?: "Sick" }
 * 200    { days: [schedule days], callList: [Appointment & { services }] }
 *        callList carries customerName and customerPhone for each call
 */
export const Route = createFileRoute('/api/v1/barber/schedule/emergency')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ request, context }) =>
        handle(async () => clearPeriod(context.staff, context.barberId, await readBody(request, emergencyInput))),
    },
  },
})
