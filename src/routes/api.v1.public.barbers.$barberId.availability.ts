import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isoDate, readId, readQuery, uuidList } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { availability } from '~/lib/server/booking/public'
import { todayLocal } from '~/lib/server/booking/time'

/**
 * GET /api/v1/public/barbers/{barberId}/availability — step 4 of booking:
 * pick a time
 *
 * Query  locationId  required
 *        from        YYYY-MM-DD, Ulaanbaatar date; default today
 *        days        1–31; default 14
 *        serviceIds  comma-separated; when given, free start times are
 *                    computed for their total duration + the barber's buffer
 *
 * Every day gets a status, because an empty day means different things:
 *   working    shifts at this location (slots listed if serviceIds given)
 *   elsewhere  working that day, but only at another location
 *   off        the barber said they won't work
 *   unknown    the barber hasn't planned this day — not "fully booked"
 *
 * Auth   none
 * 200    { barber: { id, name, onlineBooking }, locationId, blockMinutes,
 *          days: [{ date, status, shifts: [{ startsAt, endsAt }], slots: [iso] }] }
 * 400    VALIDATION / BAD_REQUEST (unknown service for this barber here)
 * 404    NOT_FOUND  barber inactive or not at this location
 */
const query = z.object({
  locationId: z.uuid(),
  from: isoDate.optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
  serviceIds: uuidList.optional(),
})

export const Route = createFileRoute('/api/v1/public/barbers/$barberId/availability')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(() => {
          const q = readQuery(request, query)
          return availability({
            barberId: readId(params, 'barberId'),
            locationId: q.locationId,
            from: q.from ?? todayLocal(),
            days: q.days,
            serviceIds: q.serviceIds ?? [],
          })
        }),
    },
  },
})
