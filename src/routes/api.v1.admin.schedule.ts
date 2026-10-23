import { createFileRoute } from '@tanstack/react-router'
import { readBody, readQuery } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { applySchedule, getSchedule, scheduleInput, scheduleQuery } from '~/lib/server/booking/schedule'

/**
 * GET /api/v1/admin/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD — the barber's
 * open windows and the bookings in them, day by day (at most 93 days)
 *
 * PUT /api/v1/admin/schedule — open (or close) days. Every day an entry
 * touches is replaced as a whole; days not mentioned are left alone.
 *
 *   { entries: [
 *       { from, to, weekdays?: [1..7], start: "10:00", end: "18:00" },
 *       { from, to, closed: true } ] }
 *
 * Several open entries may land on one day (morning and evening). Times are
 * Ulaanbaatar time; "24:00" means midnight at the end of the day. Bookings
 * are never touched by a schedule change.
 *
 * Auth   admin (adminOnly)
 * 200    [{ date, windows: [{ id, startsAt, endsAt }],
 *          appointments: [{ id, bookingNo, status, startsAt, endsAt, serviceName, customerName }] }]
 * 400    an entry ending before it starts, overlapping windows, a day both
 *        open and closed, more than 93 days
 */
export const Route = createFileRoute('/api/v1/admin/schedule')({
  server: {
    middleware: [adminOnly],
    handlers: {
      GET: ({ request }) =>
        handle(() => {
          const { from, to } = readQuery(request, scheduleQuery)
          return getSchedule(from, to)
        }),
      PUT: ({ request }) => handle(async () => applySchedule(await readBody(request, scheduleInput))),
    },
  },
})
