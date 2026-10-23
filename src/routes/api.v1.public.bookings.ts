import { createFileRoute } from '@tanstack/react-router'
import { readBody } from '~/lib/server/api/input'
import { handle } from '~/lib/server/api/respond'
import { bookingInput, createBooking } from '~/lib/server/booking/book'

/**
 * POST /api/v1/public/bookings — step 3: hold the time and pay the fee
 *
 * Holds the time for 15 minutes and returns the booking-fee QPay invoice.
 * The booking is NOT confirmed yet: only a paid fee confirms it (then the
 * confirmation email goes out). An unpaid hold is deleted, not kept.
 *
 * Keep `token`: it is the customer's only key to their booking —
 *   GET  /api/v1/public/bookings/{bookingNo}?t={token}         status
 *   POST /api/v1/public/bookings/{bookingNo}/check?t={token}   poll the fee
 *
 * Auth   none
 * Body   { serviceId, startsAt,               ISO, a slot from /slots
 *          customerName, customerPhone,       8 digits
 *          customerEmail,                     required: the confirmation goes here
 *          note? }
 * 201    { bookingNo, token, expiresAt, startsAt, endsAt, service, bookingFee,
 *          invoice: { qrText, qrImage, shortUrl, links } }
 * 400    time in the past
 * 404    unknown or inactive service
 * 409    BOOKING_OFF        no booking fee set yet
 *        NOT_AVAILABLE      outside the barber's open windows
 *        TIME_TAKEN         someone else holds or booked it
 *        HOLD_EXISTS        this phone/email already has an unpaid hold
 * 502    QPAY_UNAVAILABLE   nothing was kept; try again
 */
export const Route = createFileRoute('/api/v1/public/bookings')({
  server: {
    handlers: {
      POST: ({ request }) => handle(async () => createBooking(await readBody(request, bookingInput)), 201),
    },
  },
})
