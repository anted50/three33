import { createFileRoute } from '@tanstack/react-router'
import { notFound } from '~/lib/server/api/errors'
import { readId } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { getLocation } from '~/lib/server/booking/locations'
import { barbersAtLocation } from '~/lib/server/booking/public'

/**
 * GET /api/v1/public/locations/{locationId}/barbers — steps 2–3 of booking:
 * pick a barber, then their services
 *
 * Active barbers assigned to the location who offer at least one active
 * service there, each with those services.
 *
 * Auth   none
 * 200    [{ id, slug, name, phone, photoUrl, bioMn, bioEn, bookingFee,
 *           onlineBooking,          false = fee 0: show "call to book" + phone
 *           services: [{ id, nameEn, nameMn, descriptionEn, descriptionMn,
 *                        price, durationMinutes }] }]
 * 404    NOT_FOUND  unknown or inactive location
 */
export const Route = createFileRoute('/api/v1/public/locations/$locationId/barbers')({
  server: {
    handlers: {
      GET: ({ params }) =>
        handle(async () => {
          const location = await getLocation(readId(params, 'locationId'))
          if (!location.isActive) throw notFound('Location')
          return barbersAtLocation(location.id)
        }),
    },
  },
})
