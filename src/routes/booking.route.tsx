import { createFileRoute, Outlet } from '@tanstack/react-router'
import bookingCss from '~/styles/booking.css?url'

/**
 * /booking — the customer's side of the booking API.
 *
 * Its own stylesheet, loaded only here (like admin.css), and Inter for the
 * booking area: the flow follows the Squire-style designs, while the site
 * header and footer around it keep the storefront's mono face.
 */
export const Route = createFileRoute('/booking')({
  head: () => ({
    meta: [{ title: 'Цаг захиалах — Three33 Barber' }],
    links: [
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
      { rel: 'stylesheet', href: bookingCss },
    ],
  }),
  component: Outlet,
})
