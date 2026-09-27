import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barberSaleLines, barberSales, services } from '~/db/schema'
import { badRequest } from '../../api/errors'
import { email, mungu, phone } from '../../api/input'
import type { Staff } from '../../api/staff'
import { assertWorksAt } from '../barber-locations'
import type { Tx } from '../db'
import { generateRef } from '../refs'
import { finalizeIfCovered } from './finalize'
import { getSale } from './queries'

/**
 * A POS sale: free-form lines at whatever amount the barber decides — a
 * friend's discount, a one-off service with its own name and description.
 * A line may point at one of the barber's services for reporting, but its
 * name and amount are still the barber's call.
 */

export const saleLineInput = z.object({
  serviceId: z.uuid().nullish(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  unitAmount: mungu,
  qty: z.number().int().min(1).max(100).default(1),
})

export type SaleLineInput = z.infer<typeof saleLineInput>

export const saleInput = z.object({
  locationId: z.uuid(),
  lines: z.array(saleLineInput).min(1).max(30),
  note: z.string().trim().max(500).nullish(),
  customerName: z.string().trim().max(120).nullish(),
  customerPhone: phone.nullish(),
  customerEmail: email.nullish(),
})

export const totalOf = (lines: SaleLineInput[]) => lines.reduce((sum, l) => sum + l.unitAmount * l.qty, 0)

export async function createSale(staff: Staff, barberId: string, input: z.infer<typeof saleInput>) {
  const saleId = await db.transaction((tx) => insertSale(tx, staff, barberId, input, null))
  return getSale(barberId, saleId)
}

/** Shared with appointment checkout, which passes the appointment and the
 * booking fee already paid as credit. */
export async function insertSale(
  tx: Tx,
  staff: Staff,
  barberId: string,
  input: z.infer<typeof saleInput>,
  link: { appointmentId: string; credit: number } | null,
): Promise<string> {
  await assertWorksAt(barberId, [input.locationId], tx)
  await assertOwnServices(tx, barberId, input.lines)

  const total = totalOf(input.lines)
  const credit = link?.credit ?? 0
  if (credit > total) {
    throw badRequest('The total cannot be less than the booking fee already paid')
  }

  const [sale] = await tx
    .insert(barberSales)
    .values({
      saleNo: generateRef('SL'),
      barberId,
      locationId: input.locationId,
      appointmentId: link?.appointmentId ?? null,
      total,
      credit,
      note: input.note ?? null,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      customerEmail: input.customerEmail ?? null,
      createdBy: staff.userId,
    })
    .returning({ id: barberSales.id })

  await tx.insert(barberSaleLines).values(
    input.lines.map((line, i) => ({ ...line, serviceId: line.serviceId ?? null, saleId: sale!.id, sortOrder: i })),
  )

  // Nothing due (a free cut, or fully covered by the fee): closed at once.
  await finalizeIfCovered(tx, sale!.id, staff.userId)
  return sale!.id
}

async function assertOwnServices(tx: Tx, barberId: string, lines: SaleLineInput[]) {
  const ids = [...new Set(lines.flatMap((l) => (l.serviceId ? [l.serviceId] : [])))]
  if (ids.length === 0) return
  const own = await tx
    .select({ id: services.id })
    .from(services)
    .where(and(inArray(services.id, ids), eq(services.barberId, barberId)))
  if (own.length !== ids.length) throw badRequest('A line refers to a service that is not yours')
}
