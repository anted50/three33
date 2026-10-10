import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { createOnlineBooking, onlineBookingInput } from '~/lib/server/booking/online/create'

/**
 * POST /api/v1/public/bookings — step 5 of booking: hold the time and pay
 *
 * Holds the slot for 15 minutes and returns the booking-fee QPay invoice.
 * The booking is NOT confirmed yet: only a paid fee confirms it (then the
 * confirmation email goes out). An unpaid hold is deleted, not kept.
 *
 * Keep `token`: it is the customer's only key to their booking —
 *   GET  /api/v1/public/bookings/{bookingNo}?t={token}         status
 *   POST /api/v1/public/bookings/{bookingNo}/check?t={token}   poll the fee
 *
 * Auth   none
 * Body   { barberId, locationId, serviceIds: [uuid, …],
 *          startsAt,                         ISO, a slot from /availability
 *          customerName, customerPhone,      8 digits
 *          customerEmail,                    required: the confirmation goes here
 *          note? }
 * 201    { bookingNo, token, expiresAt, total, bookingFee, dueAtShop,
 *          invoice: { qrText, qrImage, shortUrl, links } }
 * 400    unknown service, time in the past, free services
 * 404    barber not at this location
 * 409    ONLINE_BOOKING_OFF   barber takes phone bookings only (fee 0)
 *        NOT_AVAILABLE        outside the barber's shifts
 *        TIME_TAKEN           someone else holds or booked it
 *        HOLD_EXISTS          this phone/email already has an unpaid hold
 * 502    QPAY_UNAVAILABLE     nothing was kept; try again
 */
export const Route = createFileRoute('/api/v1/public/bookings')({
  server: {
    handlers: {
      POST: ({ request }) => handle(async () => createOnlineBooking(await readBody(request, onlineBookingInput)), 201),
    },
  },
})
