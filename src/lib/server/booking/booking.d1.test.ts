import { and, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { atomic } from '~/db/atomic'
import { db } from '~/db'
import {
  appointmentEvents,
  appointmentPayments,
  appointments,
  barberLedger,
  barberLocations,
  barberSaleLines,
  barberSalePayments,
  barberShifts,
  barbers,
  inventoryLedger,
  locations,
  productVariants,
  products,
  services,
  users,
} from '~/db/schema'
import { apiErrorFromDb } from '../api/db-errors'
import type { Staff } from '../api/staff'

/**
 * The booking side on a real local D1: POS sales and their payments,
 * appointment checkout, online booking fees, and the schedule — the code
 * whose row locks became guarded batches.
 */

const qpay = {
  name: 'qpay',
  createInvoice: vi.fn(async () => ({ invoiceId: `INV-${crypto.randomUUID()}`, qrText: 'qr', qrImage: '', shortUrl: null, links: [] })),
  checkInvoice: vi.fn(),
  cancelInvoice: vi.fn(async () => {}),
}
vi.mock('../payments/qpay', () => ({ getQpayProvider: () => qpay }))
vi.mock('./emails/confirmation', () => ({ sendConfirmationInBackground: vi.fn() }))

const { createSale } = await import('./sales/create')
const { addPayment } = await import('./sales/payments')
const { checkSalePayment } = await import('./sales/settle')
const { voidSale } = await import('./sales/void')
const { startCheckout } = await import('./appointments/checkout')
const { createBarberBooking } = await import('./appointments/create')
const { reschedule, cancel } = await import('./appointments/change')
const { createOnlineBooking } = await import('./online/create')
const { checkBookingFee } = await import('./online/settle')
const { applySchedule, getSchedule } = await import('./schedule')
const { createBarber } = await import('./barbers')
const { replaceLocations } = await import('./barber-locations')

const ids = {
  owner: crypto.randomUUID(),
  location: crypto.randomUUID(),
  otherLocation: crypto.randomUUID(),
  barber: crypto.randomUUID(),
  service: crypto.randomUUID(),
  product: crypto.randomUUID(),
  variant: crypto.randomUUID(),
}
let staff: Staff

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e,
  )

beforeAll(async () => {
  await atomic([
    db.insert(users).values({ id: ids.owner, email: 'owner@example.com', name: 'Owner', role: 'admin' }),
    db.insert(locations).values({ id: ids.location, slug: 'main', nameMn: 'Төв', nameEn: 'Main', address: 'UB' }),
    db.insert(locations).values({ id: ids.otherLocation, slug: 'second', nameMn: 'Хоёр', nameEn: 'Second', address: 'UB' }),
    db.insert(barbers).values({ id: ids.barber, slug: 'b', name: 'Bat', phone: '99000000', userId: ids.owner, bookingFee: 1_000_000 }),
    db.insert(barberLocations).values({ barberId: ids.barber, locationId: ids.location }),
    db.insert(services).values({ id: ids.service, barberId: ids.barber, locationId: ids.location, nameEn: 'Cut', price: 3_000_000, durationMinutes: 30 }),
    db.insert(products).values({ id: ids.product, slug: 'pomade', nameMn: 'Помад', nameEn: 'Pomade', status: 'active' }),
    db.insert(productVariants).values({ id: ids.variant, productId: ids.product, sku: 'POM-1', price: 2_000_000, stockQty: 3 }),
  ])
  staff = { userId: ids.owner, email: 'owner@example.com', name: 'Owner', isOwner: true, barberId: ids.barber }
})

beforeEach(() => {
  qpay.checkInvoice.mockReset()
})

const stock = async () => (await db.select().from(productVariants).where(eq(productVariants.id, ids.variant)))[0]!.stockQty

describe('POS sales', () => {
  it('a cash payment covering the sale closes it, takes the stock and writes the ledger', async () => {
    const sale = await createSale(staff, ids.barber, {
      locationId: ids.location,
      lines: [{ variantId: ids.variant, qty: 1 }, { name: 'Cut', unitAmount: 3_000_000, qty: 1 }],
    })
    expect(sale.status).toBe('open')
    expect(sale.total).toBe(5_000_000)

    const after = await addPayment(staff, ids.barber, sale.id, { method: 'cash', amount: 5_000_000 })
    expect(after.status).toBe('paid')
    expect(await stock()).toBe(2)

    const [line] = await db.select().from(barberSaleLines).where(and(eq(barberSaleLines.saleId, sale.id), eq(barberSaleLines.skuSnapshot, 'POM-1')))
    expect(line!.inventoryLedgerId).not.toBeNull()
    const [movement] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.id, line!.inventoryLedgerId!))
    expect(movement).toMatchObject({ delta: -1, reason: 'pos_sale' })

    const ledger = await db.select().from(barberLedger).where(eq(barberLedger.salePaymentId, after.payments[0]!.id))
    // Cash: the barber's service share, and the cash they now hold.
    expect(ledger.map((l) => l.kind).sort()).toEqual(['cash_collected', 'service_share'])
  })

  it('split payments: the sale stays open until they add up', async () => {
    const sale = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Cut', unitAmount: 3_000_000, qty: 1 }] })
    const first = await addPayment(staff, ids.barber, sale.id, { method: 'pos', amount: 1_000_000 })
    expect(first.status).toBe('open')
    const second = await addPayment(staff, ids.barber, sale.id, { method: 'cash', amount: 2_000_000 })
    expect(second.status).toBe('paid')
    const error = await rejection(addPayment(staff, ids.barber, sale.id, { method: 'cash', amount: 100 }))
    expect(error).toMatchObject({ code: 'SALE_CLOSED' })
  })

  it('refuses more than is left to pay', async () => {
    const sale = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Cut', unitAmount: 3_000_000, qty: 1 }] })
    expect(await rejection(addPayment(staff, ids.barber, sale.id, { method: 'cash', amount: 3_000_100 }))).toMatchObject({ code: 'AMOUNT_TOO_HIGH' })
  })

  it('two payments racing for the last of a sale: one lands, the sale is never overpaid', async () => {
    const sale = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Cut', unitAmount: 3_000_000, qty: 1 }] })
    const results = await Promise.allSettled([
      addPayment(staff, ids.barber, sale.id, { method: 'cash', amount: 3_000_000 }),
      addPayment(staff, ids.barber, sale.id, { method: 'pos', amount: 3_000_000 }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const paid = await db.select().from(barberSalePayments).where(and(eq(barberSalePayments.saleId, sale.id), eq(barberSalePayments.status, 'paid')))
    expect(paid).toHaveLength(1)
  })

  it('a QPay payment is paid only when QPay says so, exactly once', async () => {
    const sale = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Cut', unitAmount: 3_000_000, qty: 1 }] })
    const withInvoice = await addPayment(staff, ids.barber, sale.id, { method: 'qpay', amount: 3_000_000 })
    const paymentId = withInvoice.payments[0]!.id
    expect(withInvoice.payments[0]!.status).toBe('pending')

    qpay.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: 3_000_000, providerPaymentId: `QP-${paymentId}`, raw: {} })
    const [a, b] = await Promise.all([checkSalePayment(paymentId), checkSalePayment(paymentId)])
    expect([a.status, b.status]).toContain('paid')

    const ledger = await db.select().from(barberLedger).where(eq(barberLedger.salePaymentId, paymentId))
    expect(ledger).toHaveLength(1) // service_share only, credited once
    const [closed] = await db.select().from(barberSalePayments).where(eq(barberSalePayments.id, paymentId))
    expect(closed!.status).toBe('paid')
  })

  it('void: only while no money has been taken', async () => {
    const empty = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Cut', unitAmount: 3_000_000, qty: 1 }] })
    expect((await voidSale(ids.barber, empty.id)).status).toBe('void')

    const part = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Cut', unitAmount: 3_000_000, qty: 1 }] })
    await addPayment(staff, ids.barber, part.id, { method: 'cash', amount: 1_000_000 })
    expect(await rejection(voidSale(ids.barber, part.id))).toMatchObject({ code: 'HAS_PAYMENTS' })
  })

  it('a free sale is closed at once', async () => {
    const sale = await createSale(staff, ids.barber, { locationId: ids.location, lines: [{ name: 'Free trim', unitAmount: 0, qty: 1 }] })
    expect(sale.status).toBe('paid')
  })
})

describe('appointments', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 15, h, m)).toISOString()
  const booking = (h: number, m = 0) =>
    createBarberBooking(staff, ids.barber, {
      locationId: ids.location,
      startsAt: at(h, m),
      serviceIds: [ids.service],
      customerName: 'Customer',
      customerPhone: '99112233',
    })

  it('refuses an overlapping booking with TIME_TAKEN; allows back to back', async () => {
    await booking(2)
    await booking(2, 30)
    expect(apiErrorFromDb(await rejection(booking(2, 15)))).toMatchObject({ code: 'TIME_TAKEN' })
  })

  it('reschedule moves the booking and logs it; onto another booking is TIME_TAKEN', async () => {
    const a = await booking(5)
    await booking(6)
    const moved = await reschedule(staff, ids.barber, a.id, { startsAt: at(7) })
    expect(new Date(moved.startsAt).toISOString()).toBe(at(7))
    const events = await db.select().from(appointmentEvents).where(and(eq(appointmentEvents.appointmentId, a.id), eq(appointmentEvents.kind, 'rescheduled')))
    expect(events).toHaveLength(1)
    expect(apiErrorFromDb(await rejection(reschedule(staff, ids.barber, a.id, { startsAt: at(6) })))).toMatchObject({ code: 'TIME_TAKEN' })
  })

  it('checkout: twice returns the same open sale; paying it completes the appointment', async () => {
    const a = await booking(9)
    const [first, second] = await Promise.all([startCheckout(staff, ids.barber, a.id, {}), startCheckout(staff, ids.barber, a.id, {})])
    expect(first.id).toBe(second.id)

    expect(await rejection(cancel(staff, ids.barber, a.id, {}))).toMatchObject({ code: 'CHECKOUT_OPEN' })

    await addPayment(staff, ids.barber, first.id, { method: 'cash', amount: first.total })
    const [done] = await db.select().from(appointments).where(eq(appointments.id, a.id))
    expect(done!.status).toBe('completed')
    const completed = await db.select().from(appointmentEvents).where(and(eq(appointmentEvents.appointmentId, a.id), eq(appointmentEvents.kind, 'completed')))
    expect(completed).toHaveLength(1)
  })
})

describe('online booking fee', () => {
  it('holds the slot, then confirms it when QPay says the fee is paid — once', async () => {
    const start = new Date(Date.UTC(2030, 1, 1, 3, 0))
    await db.insert(barberShifts).values({
      barberId: ids.barber,
      locationId: ids.location,
      startsAt: new Date(start.getTime() - 3600e3),
      endsAt: new Date(start.getTime() + 3 * 3600e3),
    })

    const booked = await createOnlineBooking({
      barberId: ids.barber,
      locationId: ids.location,
      serviceIds: [ids.service],
      startsAt: start.toISOString(),
      customerName: 'Online',
      customerPhone: '88112233',
      customerEmail: 'online@example.com',
    })
    const [hold] = await db.select().from(appointments).where(eq(appointments.bookingNo, booked.bookingNo))
    expect(hold!.status).toBe('pending')
    const [fee] = await db.select().from(appointmentPayments).where(eq(appointmentPayments.appointmentId, hold!.id))

    qpay.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: fee!.amount, providerPaymentId: `FEE-${fee!.id}`, raw: {} })
    await Promise.all([checkBookingFee(fee!.id), checkBookingFee(fee!.id)])

    const [confirmed] = await db.select().from(appointments).where(eq(appointments.id, hold!.id))
    expect(confirmed!.status).toBe('booked')
    expect(await db.select().from(barberLedger).where(eq(barberLedger.appointmentPaymentId, fee!.id))).toHaveLength(1)
    const created = await db.select().from(appointmentEvents).where(and(eq(appointmentEvents.appointmentId, hold!.id), eq(appointmentEvents.kind, 'created')))
    expect(created).toHaveLength(1)
  })
})

describe('schedule and barbers', () => {
  it('replaces a day as a whole, in Ulaanbaatar days', async () => {
    await applySchedule(ids.barber, { entries: [{ from: '2030-03-04', to: '2030-03-04', start: '10:00', end: '18:00', locationId: ids.location }] })
    await applySchedule(ids.barber, { entries: [{ from: '2030-03-04', to: '2030-03-04', start: '12:00', end: '14:00', locationId: ids.location }] })
    const [day] = await getSchedule(ids.barber, '2030-03-04', '2030-03-04')
    expect(day!.status).toBe('working')
    expect(day!.shifts).toHaveLength(1)

    await applySchedule(ids.barber, { entries: [{ from: '2030-03-04', to: '2030-03-04', off: true }] })
    const [off] = await getSchedule(ids.barber, '2030-03-04', '2030-03-04')
    expect(off).toMatchObject({ status: 'off', shifts: [] })
  })

  it('creates a barber with their login, locations and terms together', async () => {
    const created = await createBarber(
      {
        email: 'new.barber@example.com',
        name: 'New Barber',
        phone: '99887766',
        locationIds: [ids.location, ids.otherLocation],
        terms: { serviceCutBps: 3000, productCommissionBps: 500, rentAmount: 0 },
      },
      ids.owner,
    )
    expect(created.email).toBe('new.barber@example.com')
    expect(created.locationIds.sort()).toEqual([ids.location, ids.otherLocation].sort())
    expect(created.terms).toMatchObject({ serviceCutBps: 3000 })

    // A location with an active service can't be taken away.
    await db.insert(services).values({ barberId: created.id, locationId: ids.otherLocation, nameEn: 'Shave', price: 1_000_000, durationMinutes: 20 })
    expect(await rejection(replaceLocations(created.id, [ids.location]))).toMatchObject({ code: 'LOCATION_IN_USE' })
    expect((await replaceLocations(created.id, [ids.location, ids.otherLocation])).length).toBe(2)
  })
})
