import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barberSaleLines, barberSales, products, productVariants, services } from '~/db/schema'
import { badRequest } from '../../api/errors'
import { email, mungu, phone } from '../../api/input'
import type { Staff } from '../../api/staff'
import { assertWorksAt } from '../barber-locations'
import type { Tx } from '../db'
import { generateRef } from '../refs'
import { finalizeIfCovered } from './finalize'
import { getSale } from './queries'
import { assertAvailable } from './stock'

/**
 * A POS sale mixes two kinds of line:
 *
 *   product  { variantId, qty } — the owner's listed price, name and sku,
 *            filled in here; the barber can't change them. Stock is checked
 *            now and deducted when the sale is paid.
 *   free     { name, unitAmount, qty, description?, serviceId? } — any name
 *            and amount the barber decides: a friend's discount, a one-off
 *            service. serviceId only links it to one of their services.
 */

const qty = z.number().int().min(1).max(100).default(1)

export const productLineInput = z.object({ variantId: z.uuid(), qty })

export const freeLineInput = z.object({
  serviceId: z.uuid().nullish(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  unitAmount: mungu,
  qty,
})

export const saleLineInput = z.union([productLineInput, freeLineInput])
export type SaleLineInput = z.infer<typeof saleLineInput>

export const saleInput = z.object({
  locationId: z.uuid(),
  lines: z.array(saleLineInput).min(1).max(30),
  note: z.string().trim().max(500).nullish(),
  customerName: z.string().trim().max(120).nullish(),
  customerPhone: phone.nullish(),
  customerEmail: email.nullish(),
})

interface ResolvedLine {
  serviceId: string | null
  variantId: string | null
  skuSnapshot: string | null
  name: string
  description: string | null
  unitAmount: number
  qty: number
}

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
  const lines = await resolveLines(tx, barberId, input.lines)
  await assertAvailable(tx, lines.map((l) => ({ variantId: l.variantId, qty: l.qty, sku: l.skuSnapshot })))

  const lineTotal = (l: ResolvedLine) => l.unitAmount * l.qty
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const serviceTotal = lines.filter((l) => !l.skuSnapshot).reduce((sum, l) => sum + lineTotal(l), 0)
  const credit = link?.credit ?? 0
  // The booking fee pays for services, never for products.
  if (credit > serviceTotal) {
    throw badRequest('The services cannot total less than the booking fee already paid')
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

  await tx.insert(barberSaleLines).values(lines.map((line, i) => ({ ...line, saleId: sale!.id, sortOrder: i })))

  // Nothing due (a free cut, or fully covered by the fee): closed at once.
  await finalizeIfCovered(tx, sale!.id, staff.userId)
  return sale!.id
}

async function resolveLines(tx: Tx, barberId: string, lines: SaleLineInput[]): Promise<ResolvedLine[]> {
  const variantIds = lines.flatMap((l) => ('variantId' in l ? [l.variantId] : []))
  const listed = variantIds.length
    ? await tx
        .select({ id: productVariants.id, sku: productVariants.sku, size: productVariants.size, price: productVariants.price, name: products.nameEn })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(inArray(productVariants.id, variantIds), eq(productVariants.isActive, true), eq(products.status, 'active')))
    : []

  const serviceIds = [...new Set(lines.flatMap((l) => ('serviceId' in l && l.serviceId ? [l.serviceId] : [])))]
  if (serviceIds.length) {
    const own = await tx.select({ id: services.id }).from(services).where(and(inArray(services.id, serviceIds), eq(services.barberId, barberId)))
    if (own.length !== serviceIds.length) throw badRequest('A line refers to a service that is not yours')
  }

  return lines.map((l) => {
    if ('variantId' in l) {
      const v = listed.find((row) => row.id === l.variantId)
      if (!v) throw badRequest('A product in the sale is not for sale')
      return { serviceId: null, variantId: v.id, skuSnapshot: v.sku, name: v.size ? `${v.name} ${v.size}` : v.name, description: null, unitAmount: v.price, qty: l.qty }
    }
    return { serviceId: l.serviceId ?? null, variantId: null, skuSnapshot: null, name: l.name, description: l.description ?? null, unitAmount: l.unitAmount, qty: l.qty }
  })
}
