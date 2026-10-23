import { createFileRoute } from '@tanstack/react-router'
import { readId } from '~/lib/server/api/input'
import { adminOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { deleteWindow } from '~/lib/server/booking/schedule'

/**
 * DELETE /api/v1/admin/schedule/{windowId} — close one window. Bookings in
 * it stand.
 *
 * Auth   admin (adminOnly)
 * 204    removed
 * 404    unknown window
 */
export const Route = createFileRoute('/api/v1/admin/schedule/$windowId')({
  server: {
    middleware: [adminOnly],
    handlers: {
      DELETE: ({ params }) => handle(() => deleteWindow(readId(params, 'windowId'))),
    },
  },
})
