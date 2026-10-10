/**
 * Booking sweep: deletes unpaid online-booking holds past their deadline, and
 * checks POS QPay payments whose callback never arrived.
 *
 * Normally run on a timer by the server (see server/index.mjs); runnable by
 * hand with `npm run booking:sweep`. The work lives in
 * src/lib/server/booking/sweep.ts — this is only the command-line wrapper.
 */
import { sweepBooking } from '~/lib/server/booking/sweep'

async function main() {
  const tally = await sweepBooking()
  console.log('booking-sweep:', JSON.stringify(tally))
  return tally.errors === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('booking-sweep: failed', error)
    process.exit(1)
  })
