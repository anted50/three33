import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentEvents, appointments } from '~/db/schema'
import { isoDate } from '../../api/input'
import type { Staff } from '../../api/staff'
import { applySchedule } from '../schedule'
import { addDays, atLocal } from '../time'
import { listAppointments } from './queries'

/**
 * The barber can't work a period — sick, an emergency. In one call:
 *
 *   1. every day in the period becomes a day off, so no new online bookings
 *   2. every booking in it is flagged (needs_reschedule_at) and logged
 *
 * Nothing is cancelled or moved automatically: each customer is called
 * personally, then rescheduled (which clears the flag) or cancelled. The
 * returned call list — also GET /barber/appointments?needsReschedule=true —
 * has each customer's name and phone. Flagged bookings keep their old times
 * until handled, so nothing new lands on top of them.
 */
export const emergencyInput = z.object({
  from: isoDate,
  to: isoDate,
  note: z.string().trim().max(200).optional(),
})

export async function clearPeriod(staff: Staff, barberId: string, input: z.infer<typeof emergencyInput>) {
  const days = await applySchedule(barberId, {
    entries: [{ from: input.from, to: input.to, off: true, note: input.note ?? 'Emergency' }],
  })

  await db.transaction(async (tx) => {
    const flagged = await tx
      .update(appointments)
      .set({ needsRescheduleAt: new Date() })
      .where(
        and(
          eq(appointments.barberId, barberId),
          inArray(appointments.status, ['booked', 'pending']),
          isNull(appointments.needsRescheduleAt),
          gte(appointments.startsAt, atLocal(input.from, '00:00')),
          lt(appointments.startsAt, atLocal(addDays(input.to, 1), '00:00')),
        ),
      )
      .returning({ id: appointments.id, status: appointments.status })
    const booked = flagged.filter((a) => a.status === 'booked')
    if (booked.length > 0) {
      await tx.insert(appointmentEvents).values(
        booked.map((a) => ({ appointmentId: a.id, kind: 'flagged' as const, actorId: staff.userId, note: input.note ?? null })),
      )
    }
  })

  const callList = await listAppointments(barberId, { from: input.from, to: input.to, status: 'booked', needsReschedule: 'true' })
  return { days, callList }
}
