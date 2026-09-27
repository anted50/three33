import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { appointmentEvents, appointmentServices, appointments, barbers, services } from '~/db/schema'
import { badRequest } from '../../api/errors'
import { email, phone } from '../../api/input'
import type { Staff } from '../../api/staff'
import { assertWorksAt } from '../barber-locations'
import { sendConfirmationInBackground } from '../emails/confirmation'
import { generateRef } from '../refs'
import { addMinutes } from '../time'
import { getAppointment } from './queries'

/**
 * A booking the barber enters themselves — a phone call or someone at the
 * chair. Creating it IS the barber's confirmation, so it is booked at once
 * with no fee and no hold, at ANY time: inside a shift it takes those slots
 * from online booking automatically; outside every shift it is overtime and
 * leaves the planned schedule alone. The only thing refused is overlapping
 * another of the barber's bookings (appointments_no_overlap).
 */
export const barberBookingInput = z.object({
  locationId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  serviceIds: z.array(z.uuid()).min(1).max(10),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: phone,
  customerEmail: email.nullish(),
  note: z.string().trim().max(500).nullish(),
})

export async function createBarberBooking(staff: Staff, barberId: string, input: z.infer<typeof barberBookingInput>) {
  await assertWorksAt(barberId, [input.locationId])

  const picked = await db
    .select()
    .from(services)
    .where(
      and(
        inArray(services.id, input.serviceIds),
        eq(services.barberId, barberId),
        eq(services.locationId, input.locationId),
        eq(services.isActive, true),
      ),
    )
  if (picked.length !== new Set(input.serviceIds).size) {
    throw badRequest('Unknown or inactive service for this location')
  }
  const ordered = input.serviceIds.map((id) => picked.find((s) => s.id === id)!)

  const [barber] = await db.select({ bufferMinutes: barbers.bufferMinutes }).from(barbers).where(eq(barbers.id, barberId)).limit(1)
  const startsAt = new Date(input.startsAt)
  const endsAt = addMinutes(startsAt, ordered.reduce((sum, s) => sum + s.durationMinutes, 0))
  const buffer = barber!.bufferMinutes

  const id = await db.transaction(async (tx) => {
    const [appointment] = await tx
      .insert(appointments)
      .values({
        bookingNo: generateRef('BK'),
        locationId: input.locationId,
        barberId,
        source: 'barber',
        status: 'booked',
        startsAt,
        endsAt,
        blockedUntil: addMinutes(endsAt, buffer),
        bufferMinutes: buffer,
        total: ordered.reduce((sum, s) => sum + s.price, 0),
        bookingFee: 0,
        confirmedAt: new Date(),
        confirmedBy: staff.userId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail ?? null,
        note: input.note ?? null,
        // No customer link is sent yet; the hash still guards the future one.
        accessTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      })
      .returning({ id: appointments.id })

    await tx.insert(appointmentServices).values(
      ordered.map((s, i) => ({
        appointmentId: appointment!.id,
        serviceId: s.id,
        nameSnapshot: s.nameEn,
        priceSnapshot: s.price,
        durationMinutesSnapshot: s.durationMinutes,
        sortOrder: i,
      })),
    )
    await tx.insert(appointmentEvents).values({ appointmentId: appointment!.id, kind: 'created', actorId: staff.userId, note: 'Entered by barber' })
    return appointment!.id
  })

  // Entering it is the confirmation, so the email goes now (if there is one).
  if (input.customerEmail) sendConfirmationInBackground(id)
  return getAppointment(barberId, id)
}
