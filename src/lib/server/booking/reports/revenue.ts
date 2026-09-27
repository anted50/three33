import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import {
  appointmentPayments,
  appointments,
  barberSaleLines,
  barberSalePayments,
  barberSales,
  barbers,
  inStoreSales,
  locations,
  orders,
  payments,
} from '~/db/schema'
import { badRequest } from '../../api/errors'
import { isoDate } from '../../api/input'
import { addDays, atLocal, datesBetween, localDateOf } from '../time'
import { addTo, saleSplit } from './revenue-math'

/**
 * The owner's money report: e-commerce versus the shop floor.
 *
 *   ecommerce        online shop orders, by the day their payment landed
 *                    (goods and shipping apart; refunded/cancelled excluded)
 *   inStoreProducts  products sold through the barbers' POS
 *   services         booking fees (the day they were paid online) + service
 *                    lines of POS sales (the day the sale closed, minus the
 *                    fee already counted) — split into appointments and
 *                    walk-ins
 *
 * byMethod is the cash-flow view: money that actually arrived in the range,
 * per method, across all channels — what to reconcile the cash drawer and
 * bank statement against. It can differ slightly from the buckets for a sale
 * paid across two days.
 *
 * Revenue, not profit: no product cost prices are stored anywhere yet.
 */
export const revenueQuery = z.object({ from: isoDate, to: isoDate })

const EARNING = ['paid', 'processing', 'shipped', 'delivered'] as const
const blankDay = () => ({ ecommerce: 0, inStoreProducts: 0, services: 0 })
const blankSplit = () => ({ products: 0, services: 0 })

export async function revenueReport(query: z.infer<typeof revenueQuery>) {
  if (query.to < query.from) throw badRequest('"to" is before "from"')
  if (datesBetween(query.from, query.to).length > 366) throw badRequest('At most one year at a time')
  const start = atLocal(query.from, '00:00')
  const end = atLocal(addDays(query.to, 1), '00:00')

  const days = new Map<string, ReturnType<typeof blankDay>>()
  const byLocation = new Map<string, ReturnType<typeof blankSplit>>()
  const byBarber = new Map<string, ReturnType<typeof blankSplit>>()
  const byMethod = { qpay: 0, cash: 0, pos: 0, bank_transfer: 0 }

  // E-commerce: online orders whose payment landed in range. Orders marked as
  // in-store sales (the older 0006 path) are excluded — the POS covers those.
  const online = await db
    .select({ subtotal: orders.subtotal, shippingFee: orders.shippingFee, amount: payments.amount, paidAt: payments.paidAt })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(inStoreSales, eq(inStoreSales.orderId, orders.id))
    .where(and(eq(payments.status, 'paid'), gte(payments.paidAt, start), lt(payments.paidAt, end), inArray(orders.status, EARNING), isNull(inStoreSales.orderId)))
  const ecommerce = { orders: online.length, goods: 0, shipping: 0, total: 0 }
  for (const o of online) {
    ecommerce.goods += o.subtotal
    ecommerce.shipping += o.shippingFee
    ecommerce.total += o.subtotal + o.shippingFee
    byMethod.qpay += o.amount
    addTo(days, localDateOf(o.paidAt!), 'ecommerce', o.subtotal, blankDay)
  }

  // Booking fees paid online in range.
  const fees = await db
    .select({ amount: appointmentPayments.amount, paidAt: appointmentPayments.paidAt, barberId: appointments.barberId, locationId: appointments.locationId })
    .from(appointmentPayments)
    .innerJoin(appointments, eq(appointments.id, appointmentPayments.appointmentId))
    .where(and(eq(appointmentPayments.kind, 'booking_fee'), eq(appointmentPayments.status, 'paid'), gte(appointmentPayments.paidAt, start), lt(appointmentPayments.paidAt, end)))
  const services = { total: 0, bookingFees: 0, appointments: 0, walkIns: 0 }
  for (const f of fees) {
    services.bookingFees += f.amount
    byMethod.qpay += f.amount
    addTo(days, localDateOf(f.paidAt!), 'services', f.amount, blankDay)
    addTo(byLocation, f.locationId, 'services', f.amount, blankSplit)
    addTo(byBarber, f.barberId, 'services', f.amount, blankSplit)
  }

  // POS sales closed in range.
  const sales = await db
    .select({ id: barberSales.id, barberId: barberSales.barberId, locationId: barberSales.locationId, appointmentId: barberSales.appointmentId, credit: barberSales.credit, paidAt: barberSales.paidAt })
    .from(barberSales)
    .where(and(eq(barberSales.status, 'paid'), gte(barberSales.paidAt, start), lt(barberSales.paidAt, end)))
  const lines = sales.length
    ? await db
        .select({ saleId: barberSaleLines.saleId, unitAmount: barberSaleLines.unitAmount, qty: barberSaleLines.qty, skuSnapshot: barberSaleLines.skuSnapshot })
        .from(barberSaleLines)
        .where(inArray(barberSaleLines.saleId, sales.map((s) => s.id)))
    : []
  const inStoreProducts = { total: 0, units: 0 }
  for (const sale of sales) {
    const split = saleSplit(sale, lines.filter((l) => l.saleId === sale.id))
    inStoreProducts.total += split.products
    inStoreProducts.units += split.units
    if (sale.appointmentId) services.appointments += split.services
    else services.walkIns += split.services
    const day = localDateOf(sale.paidAt!)
    addTo(days, day, 'inStoreProducts', split.products, blankDay)
    addTo(days, day, 'services', split.services, blankDay)
    for (const [map, key] of [[byLocation, sale.locationId], [byBarber, sale.barberId]] as const) {
      addTo(map, key, 'products', split.products, blankSplit)
      addTo(map, key, 'services', split.services, blankSplit)
    }
  }
  services.total = services.bookingFees + services.appointments + services.walkIns

  // Cash flow: POS payments that landed in range, by method.
  const posPayments = await db
    .select({ method: barberSalePayments.method, amount: barberSalePayments.amount })
    .from(barberSalePayments)
    .where(and(eq(barberSalePayments.status, 'paid'), gte(barberSalePayments.paidAt, start), lt(barberSalePayments.paidAt, end)))
  for (const p of posPayments) byMethod[p.method] += p.amount

  return {
    from: query.from,
    to: query.to,
    totals: {
      ecommerce: ecommerce.goods,
      inStoreProducts: inStoreProducts.total,
      products: ecommerce.goods + inStoreProducts.total,
      services: services.total,
      shipping: ecommerce.shipping,
      all: ecommerce.goods + ecommerce.shipping + inStoreProducts.total + services.total,
    },
    ecommerce,
    inStoreProducts,
    services,
    byLocation: await named(byLocation, locations, locations.nameEn),
    byBarber: await named(byBarber, barbers, barbers.name),
    byMethod,
    days: datesBetween(query.from, query.to).map((date) => ({ date, ...(days.get(date) ?? blankDay()) })),
  }
}

async function named(
  map: Map<string, ReturnType<typeof blankSplit>>,
  table: typeof locations | typeof barbers,
  nameColumn: typeof locations.nameEn | typeof barbers.name,
) {
  if (map.size === 0) return []
  const rows = await db.select({ id: table.id, name: nameColumn }).from(table).where(inArray(table.id, [...map.keys()]))
  return [...map.entries()].map(([id, split]) => ({ id, name: rows.find((r) => r.id === id)?.name ?? null, ...split }))
}
