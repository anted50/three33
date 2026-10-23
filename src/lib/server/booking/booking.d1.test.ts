import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '~/db'
import { appointments, availability } from '~/db/schema'
import { apiErrorFromDb } from '../api/db-errors'

/**
 * Booking on a real local D1: one barber, his services and open windows,
 * customers holding a time and paying the fee, and the admin moving or
 * cancelling bookings. QPay and the email are faked; what is under test is
 * what the database ends up holding, races included.
 */

const qpay = {
  name: 'qpay',
  createInvoice: vi.fn(async () => ({ invoiceId: `INV-${crypto.randomUUID()}`, qrText: 'qr', qrImage: '', shortUrl: null, links: [] })),
  checkInvoice: vi.fn(),
  cancelInvoice: vi.fn(async () => {}),
}
vi.mock('../payments/qpay', () => ({ getQpayProvider: () => qpay }))
const sendConfirmation = vi.fn(async () => 'sent' as const)
vi.mock('./emails/confirmation', () => ({ sendConfirmation }))

const { saveBookingFee } = await import('../settings')
const { createService, updateService } = await import('./services')
const { applySchedule, deleteWindow, getSchedule } = await import('./schedule')
const { bookingOptions, availableSlots } = await import('./public')
const { createBooking } = await import('./book')
const { checkBookingFee } = await import('./fee')
const { bookingStatus } = await import('./status')
const { listAppointments, reschedule, cancel, resendConfirmation } = await import('./appointments')
const { sweepBooking } = await import('./sweep')

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e,
  )

/** 2030-01-<day> at hh:mm Ulaanbaatar time, as an ISO string. */
const at = (day: number, hhmm: string) => new Date(`2030-01-${String(day).padStart(2, '0')}T${hhmm}:00+08:00`).toISOString()

let phoneSeq = 10_000_000
const customer = () => {
  const n = phoneSeq++
  return { customerName: `Customer ${n}`, customerPhone: String(n), customerEmail: `c${n}@example.com` }
}

/** Books and pays: a confirmed booking. */
async function confirmedBooking(serviceId: string, startsAt: string) {
  const held = await createBooking({ serviceId, startsAt, ...customer() })
  const [row] = await db.select().from(appointments).where(eq(appointments.bookingNo, held.bookingNo))
  qpay.checkInvoice.mockResolvedValueOnce({ outcome: 'paid', paidAmount: row!.bookingFee, providerPaymentId: `PAY-${row!.id}`, raw: {} })
  await checkBookingFee(row!.id)
  return { ...held, id: row!.id }
}

let haircut: { id: string }

beforeEach(() => {
  qpay.checkInvoice.mockReset()
  qpay.cancelInvoice.mockClear()
  sendConfirmation.mockClear()
})

describe('setup by the barber', () => {
  it('refuses online booking until a booking fee is set', async () => {
    haircut = await createService({ name: 'Haircut', durationMinutes: 45, price: 3_500_000 })
    await applySchedule({ entries: [{ from: '2030-01-01', to: '2030-01-31', start: '10:00', end: '18:00' }] })

    expect((await bookingOptions()).bookingFee).toBeNull()
    expect(await rejection(createBooking({ serviceId: haircut.id, startsAt: at(2, '10:00'), ...customer() }))).toMatchObject({
      code: 'BOOKING_OFF',
    })

    await saveBookingFee(1_000_000)
    const options = await bookingOptions()
    expect(options.bookingFee).toBe(1_000_000)
    expect(options.services).toEqual([expect.objectContaining({ name: 'Haircut', durationMinutes: 45, price: 3_500_000 })])
  })

  it('replaces a day as a whole; windows never overlap', async () => {
    await applySchedule({
      entries: [
        { from: '2030-01-20', to: '2030-01-20', start: '09:00', end: '12:00' },
        { from: '2030-01-20', to: '2030-01-20', start: '20:00', end: '24:00' },
      ],
    })
    const [day] = await getSchedule('2030-01-20', '2030-01-20')
    expect(day!.windows).toHaveLength(2)

    await applySchedule({ entries: [{ from: '2030-01-20', to: '2030-01-20', closed: true }] })
    const [closed] = await getSchedule('2030-01-20', '2030-01-20')
    expect(closed!.windows).toHaveLength(0)

    const [jan21] = await getSchedule('2030-01-21', '2030-01-21')
    await deleteWindow(jan21!.windows[0]!.id)
    expect((await getSchedule('2030-01-21', '2030-01-21'))[0]!.windows).toHaveLength(0)

    // The trigger backs up the plan's own overlap check.
    const error = await rejection(
      db
        .insert(availability)
        .values({ startsAt: new Date(at(22, '12:00')), endsAt: new Date(at(22, '13:00')) })
        .then((r) => r),
    )
    expect(apiErrorFromDb(error)).toMatchObject({ code: 'WINDOW_OVERLAP' })
  })
})

describe('a customer booking', () => {
  it('only offers times inside open windows, around existing bookings', async () => {
    await confirmedBooking(haircut.id, at(3, '11:00'))
    const { days } = await availableSlots({ serviceId: haircut.id, from: '2030-01-03', days: 1 })
    const slots = days[0]!.slots.map((d) => d.toISOString())
    expect(slots[0]).toBe(at(3, '10:00'))
    expect(slots).not.toContain(at(3, '10:30')) // would run into 11:00
    expect(slots).toContain(at(3, '11:45'))
    expect(slots.at(-1)).toBe(at(3, '17:15')) // 45 minutes still fit before 18:00

    const closed = await availableSlots({ serviceId: haircut.id, from: '2030-02-01', days: 1 })
    expect(closed.days[0]!.slots).toEqual([])
  })

  it('holds the time, then confirms it when the fee is paid — once, with one email', async () => {
    const held = await createBooking({ serviceId: haircut.id, startsAt: at(4, '10:00'), ...customer() })
    expect(held.invoice.qrText).toBe('qr')
    expect((await bookingStatus(held.bookingNo, held.token)).state).toBe('holding')

    const [row] = await db.select().from(appointments).where(eq(appointments.bookingNo, held.bookingNo))
    qpay.checkInvoice.mockResolvedValue({ outcome: 'paid', paidAmount: 1_000_000, providerPaymentId: `PAY-${row!.id}`, raw: {} })
    await Promise.all([checkBookingFee(row!.id), checkBookingFee(row!.id)])

    const status = await bookingStatus(held.bookingNo, held.token)
    expect(status).toMatchObject({ state: 'confirmed', feePaid: true, service: 'Haircut' })
    expect(sendConfirmation).toHaveBeenCalledTimes(1)
    expect(await rejection(bookingStatus(held.bookingNo, 'wrong-token-1234'))).toMatchObject({ code: 'NOT_BOOKED' })
  })

  it('refuses times outside the windows, and a second unpaid hold', async () => {
    expect(await rejection(createBooking({ serviceId: haircut.id, startsAt: at(5, '17:30'), ...customer() }))).toMatchObject({
      code: 'NOT_AVAILABLE',
    })
    const someone = customer()
    await createBooking({ serviceId: haircut.id, startsAt: at(5, '10:00'), ...someone })
    expect(await rejection(createBooking({ serviceId: haircut.id, startsAt: at(5, '14:00'), ...someone }))).toMatchObject({
      code: 'HOLD_EXISTS',
    })
  })

  it('two customers racing for one time: one holds it, the other hears TIME_TAKEN', async () => {
    const results = await Promise.allSettled([
      createBooking({ serviceId: haircut.id, startsAt: at(6, '12:00'), ...customer() }),
      createBooking({ serviceId: haircut.id, startsAt: at(6, '12:15'), ...customer() }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(apiErrorFromDb(lost.reason)).toMatchObject({ code: 'TIME_TAKEN' })
  })

  it('an inactive service cannot be booked', async () => {
    const beard = await createService({ name: 'Beard trim', durationMinutes: 20 })
    await updateService(beard.id, { isActive: false })
    expect(await rejection(createBooking({ serviceId: beard.id, startsAt: at(7, '10:00'), ...customer() }))).toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('removes the hold again when QPay will not issue the invoice', async () => {
    qpay.createInvoice.mockRejectedValueOnce(new Error('QPay down'))
    expect(await rejection(createBooking({ serviceId: haircut.id, startsAt: at(8, '10:00'), ...customer() }))).toMatchObject({
      code: 'QPAY_UNAVAILABLE',
    })
    const left = await db.select().from(appointments).where(eq(appointments.startsAt, new Date(at(8, '10:00'))))
    expect(left).toHaveLength(0)
  })
})

describe('the admin', () => {
  it('sees bookings, not unpaid holds', async () => {
    await createBooking({ serviceId: haircut.id, startsAt: at(9, '10:00'), ...customer() })
    const confirmed = await confirmedBooking(haircut.id, at(9, '12:00'))
    const listed = await listAppointments({ from: '2030-01-09', to: '2030-01-09' })
    expect(listed.map((a) => a.id)).toEqual([confirmed.id])
    expect(listed[0]).not.toHaveProperty('accessTokenHash')
  })

  it('reschedules to any free time, keeping the length; never onto another booking', async () => {
    const a = await confirmedBooking(haircut.id, at(10, '10:00'))
    await confirmedBooking(haircut.id, at(10, '14:00'))

    const moved = await reschedule(a.id, { startsAt: at(10, '19:00') }) // outside the window: the admin may
    expect(moved.startsAt.toISOString()).toBe(at(10, '19:00'))
    expect(moved.endsAt.toISOString()).toBe(at(10, '19:45'))
    expect(apiErrorFromDb(await rejection(reschedule(a.id, { startsAt: at(10, '14:30') })))).toMatchObject({ code: 'TIME_TAKEN' })

    expect(await resendConfirmation(a.id)).toEqual({ outcome: 'sent' })
  })

  it('cancels, which frees the time for someone else', async () => {
    const a = await confirmedBooking(haircut.id, at(11, '10:00'))
    expect((await cancel(a.id)).status).toBe('cancelled')
    expect(await rejection(cancel(a.id))).toMatchObject({ code: 'NOT_BOOKED' })
    await confirmedBooking(haircut.id, at(11, '10:00'))
  })
})

describe('the sweep', () => {
  it('deletes an unpaid hold past its time (cancelling the invoice), and confirms a late payment', async () => {
    const unpaid = await createBooking({ serviceId: haircut.id, startsAt: at(12, '10:00'), ...customer() })
    const latePaid = await createBooking({ serviceId: haircut.id, startsAt: at(12, '12:00'), ...customer() })
    await db.update(appointments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.status, 'pending'))

    const [paidRow] = await db.select().from(appointments).where(eq(appointments.bookingNo, latePaid.bookingNo))
    qpay.checkInvoice.mockImplementation(async (invoiceId: string) =>
      invoiceId === paidRow!.qpayInvoiceId
        ? { outcome: 'paid', paidAmount: 1_000_000, providerPaymentId: `PAY-${paidRow!.id}`, raw: {} }
        : { outcome: 'unpaid', paidAmount: 0, providerPaymentId: null, raw: {} },
    )

    const tally = await sweepBooking()
    expect(tally.holdsConfirmed).toBeGreaterThanOrEqual(1)
    expect(tally.errors).toBe(0)
    expect(await db.select().from(appointments).where(eq(appointments.bookingNo, unpaid.bookingNo))).toHaveLength(0)
    expect((await bookingStatus(latePaid.bookingNo, latePaid.token)).state).toBe('confirmed')
    expect(qpay.cancelInvoice).toHaveBeenCalled()
  })
})
