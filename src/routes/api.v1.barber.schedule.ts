import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isoDate, readBody, readQuery } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { applySchedule, getSchedule, scheduleInput } from '~/lib/server/booking/schedule'
import { addDays, todayLocal } from '~/lib/server/booking/time'

/**
 * /api/v1/barber/schedule — when and where the barber works
 *
 * GET   Day by day, each "working" (with shifts), "off", or "unknown".
 *       Query from=YYYY-MM-DD (default today), to=YYYY-MM-DD (default +13 days)
 *       200  [{ date, status, note, shifts: [{ id, locationId, startsAt, endsAt }] }]
 *
 * PUT   Set any batch of days. Each entry covers a date range, optionally
 *       only some weekdays (1 = Mon … 7 = Sun), and is one of:
 *         { from, to, weekdays?, start: "HH:MM", end: "HH:MM", locationId }  work
 *         { from, to, weekdays?, off: true, note? }                          day off
 *         { from, to, weekdays?, clear: true }                               back to unknown
 *       Every day an entry touches is replaced as a whole, so re-sending is
 *       safe. Two work entries may share a day (morning at A, afternoon at
 *       B). Bookings are never moved or cancelled by this; one that ends up
 *       outside the new shifts simply becomes overtime.
 *
 *       Example — Mon–Wed 9–15, Thu off, Fri–Sun 16–22:
 *       { "entries": [
 *         { "from": "2026-10-05", "to": "2026-10-07", "start": "09:00", "end": "15:00", "locationId": "…" },
 *         { "from": "2026-10-08", "to": "2026-10-08", "off": true },
 *         { "from": "2026-10-09", "to": "2026-10-11", "start": "16:00", "end": "22:00", "locationId": "…" } ] }
 *
 *       200  the schedule for the days touched (same shape as GET)
 *       400  BAD_REQUEST  overlapping shifts, a day given two meanings, range > 62 days
 *       403  FORBIDDEN    a location you're not assigned to
 *       409  SHIFT_OVERLAP  clashes with a shift on a day not in this request
 *
 * Auth  barber (barberOnly). Times are Ulaanbaatar local.
 */
const range = z.object({ from: isoDate.optional(), to: isoDate.optional() })

export const Route = createFileRoute('/api/v1/barber/schedule')({
  server: {
    middleware: [barberOnly],
    handlers: {
      GET: ({ request, context }) =>
        handle(() => {
          const q = readQuery(request, range)
          const from = q.from ?? todayLocal()
          return getSchedule(context.barberId, from, q.to ?? addDays(from, 13))
        }),
      PUT: ({ request, context }) =>
        handle(async () => applySchedule(context.barberId, await readBody(request, scheduleInput))),
    },
  },
})
