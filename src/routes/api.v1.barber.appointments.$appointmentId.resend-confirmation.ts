import { createFileRoute } from '@tanstack/react-router'
import { conflict } from '~/lib/server/api/errors'
import { readId } from '~/lib/server/api/input'
import { barberOnly } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'
import { getAppointment } from '~/lib/server/booking/appointments/queries'
import { sendConfirmation } from '~/lib/server/booking/emails/confirmation'

/**
 * POST /api/v1/barber/appointments/{appointmentId}/resend-confirmation
 *
 * Sends the confirmation email again — the customer lost it, or the first
 * send failed. Only for confirmed bookings with an email on file.
 *
 * Auth   barber (barberOnly)
 * Body   {}
 * 200    { outcome: "sent" | "mail_disabled" }
 * 404    NOT_FOUND
 * 409    NOT_BOOKED, NO_EMAIL
 */
export const Route = createFileRoute('/api/v1/barber/appointments/$appointmentId/resend-confirmation')({
  server: {
    middleware: [barberOnly],
    handlers: {
      POST: ({ params, context }) =>
        handle(async () => {
          const appointment = await getAppointment(context.barberId, readId(params, 'appointmentId'))
          if (appointment.status !== 'booked') throw conflict('NOT_BOOKED', `Appointment is ${appointment.status}`)
          if (!appointment.customerEmail) throw conflict('NO_EMAIL', 'No email on file for this customer')
          return { outcome: await sendConfirmation(appointment.id, { force: true }) }
        }),
    },
  },
})
