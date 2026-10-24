import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { clearValidity, localizeValidity } from '~/lib/form-messages'
import { adminBookingApi } from '~/lib/booking/admin-api'
import type { AdminService, ServiceInput } from '~/lib/booking/admin-api'
import { formatDuration } from '~/lib/booking/calendar'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'

/**
 * What can be booked, and the fee that confirms an online booking.
 *
 * Same shape as Ангилал: rows edit inline, adding is a collapsed form. There
 * is no delete — a service is turned off instead, so past bookings keep a
 * real row to point at (and keep the name and length they were booked with).
 */
export const Route = createFileRoute('/admin/services')({
  // Reads /api/v1/admin from the browser, with the admin's session cookie.
  ssr: false,
  loader: async () => {
    const [services, fee] = await Promise.all([adminBookingApi.services(), adminBookingApi.bookingFee()])
    return { services, bookingFee: fee.bookingFee }
  },
  component: Services,
})

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

function Services() {
  const { services, bookingFee } = Route.useLoaderData()

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Үйлчилгээ</h1>
          <p className="adm__muted">Хэрэглэгч онлайнаар захиалах үйлчилгээ, хугацаа, үнэ.</p>
        </div>
      </header>

      {/* Full width: seven editable columns don't fit beside a side panel. */}
      <div className="bka-stack">
        <section className="adm__card">
          <table className="adm__table adm__table--form bka-services">
            <thead>
              <tr>
                <th>Нэр</th>
                <th>Тайлбар</th>
                <th>Хугацаа (мин)</th>
                <th>Үнэ (₮)</th>
                <th>Эрэмбэ</th>
                <th>Идэвхтэй</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.length === 0 && (
                <tr>
                  <td colSpan={7} className="adm__muted">
                    Үйлчилгээ алга. Доороос нэмнэ үү.
                  </td>
                </tr>
              )}
              {services.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
            </tbody>
          </table>
          <AddServiceForm nextSortOrder={services.reduce((max, s) => Math.max(max, s.sortOrder + 1), 0)} />
        </section>

        <BookingFeeCard bookingFee={bookingFee} />
      </div>
    </>
  )
}

/** Tugrik as typed → mungu, or undefined when it isn't a whole, non-negative amount. */
function parseTugrik(value: string): number | undefined {
  const n = Number(value.replace(/[,\s₮]/g, ''))
  return value.trim() !== '' && Number.isInteger(n) && n >= 0 ? tugrikToMungu(n) : undefined
}

function ServiceRow({ service }: { service: AdminService }) {
  const router = useRouter()
  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? '')
  const [minutes, setMinutes] = useState(String(service.durationMinutes))
  const [price, setPrice] = useState(service.price === null ? '' : String(munguToTugrik(service.price)))
  const [sortOrder, setSortOrder] = useState(String(service.sortOrder))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch: Partial<ServiceInput> = {}
  if (name.trim() !== service.name) patch.name = name.trim()
  if ((description.trim() || null) !== service.description) patch.description = description.trim() || null
  if (minutes !== String(service.durationMinutes)) patch.durationMinutes = Number(minutes)
  const priceMungu = price.trim() === '' ? null : parseTugrik(price)
  if (priceMungu !== service.price) patch.price = priceMungu
  if (sortOrder !== String(service.sortOrder)) patch.sortOrder = Number(sortOrder)
  const dirty = Object.keys(patch).length > 0

  async function save(changes: Partial<ServiceInput>) {
    setError(null)
    if (changes.name !== undefined && !changes.name) return setError('Нэр хоосон байна')
    if (changes.durationMinutes !== undefined && !(Number.isInteger(changes.durationMinutes) && changes.durationMinutes >= 5 && changes.durationMinutes <= 600))
      return setError('Хугацаа 5–600 минут')
    if (changes.price === undefined && 'price' in changes) return setError('Үнэ буруу байна')
    if (changes.sortOrder !== undefined && !(Number.isInteger(changes.sortOrder) && changes.sortOrder >= 0)) return setError('Эрэмбэ буруу байна')
    setBusy(true)
    try {
      await adminBookingApi.updateService(service.id, changes)
      await router.invalidate()
    } catch (err) {
      setError(errorText(err, 'Хадгалахад алдаа гарлаа'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <tr data-inactive={!service.isActive}>
        <td>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Нэр" />
        </td>
        <td>
          <input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Тайлбар" placeholder="—" />
        </td>
        <td>
          <input value={minutes} inputMode="numeric" size={4} onChange={(e) => setMinutes(e.target.value)} aria-label="Хугацаа" />
          <div className="adm__hint adm__muted">{Number(minutes) > 0 ? formatDuration(Number(minutes)) : ''}</div>
        </td>
        <td>
          <input value={price} inputMode="numeric" size={8} onChange={(e) => setPrice(e.target.value)} aria-label="Үнэ" placeholder="—" />
        </td>
        <td>
          <input value={sortOrder} inputMode="numeric" size={3} onChange={(e) => setSortOrder(e.target.value)} aria-label="Эрэмбэ" />
        </td>
        <td>
          <label className="bka-check">
            <input type="checkbox" checked={service.isActive} disabled={busy} onChange={(e) => save({ isActive: e.target.checked })} />
            <span>{service.isActive ? 'Тийм' : 'Үгүй'}</span>
          </label>
        </td>
        <td className="adm__actionscell">
          <button type="button" className="btn btn--sm" disabled={!dirty || busy} onClick={() => save(patch)}>
            {busy ? '…' : 'Хадгалах'}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7}>
            <p className="error">{error}</p>
          </td>
        </tr>
      )}
    </>
  )
}

function AddServiceForm({ nextSortOrder }: { nextSortOrder: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState('45')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <div className="adm__pad">
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(true)}>
          + Үйлчилгээ нэмэх
        </button>
      </div>
    )
  }

  return (
    <div className="adm__pad">
      <form
        className="varrow"
        onInvalidCapture={localizeValidity}
        onInput={clearValidity}
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          const duration = Number(minutes)
          if (!Number.isInteger(duration) || duration < 5 || duration > 600) return setError('Хугацаа 5–600 минут')
          const priceMungu = price.trim() === '' ? null : parseTugrik(price)
          if (priceMungu === undefined) return setError('Үнэ буруу байна')
          setBusy(true)
          try {
            await adminBookingApi.createService({
              name: name.trim(),
              description: description.trim() || null,
              durationMinutes: duration,
              price: priceMungu,
              sortOrder: nextSortOrder,
            })
            await router.invalidate()
            setName('')
            setDescription('')
            setPrice('')
            setOpen(false)
          } catch (err) {
            setError(errorText(err, 'Хадгалахад алдаа гарлаа'))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="adm__cols">
          <label className="field">
            <span>Нэр</span>
            <input value={name} required maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Үс засалт" />
          </label>
          <label className="field">
            <span>Тайлбар (заавал биш)</span>
            <input value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="adm__cols">
          <label className="field">
            <span>Хугацаа (минут)</span>
            <input value={minutes} required inputMode="numeric" onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <label className="field">
            <span>Үнэ (₮, газар дээр төлнө — заавал биш)</span>
            <input value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="adm__actions">
          <button type="submit" className="btn btn--sm" disabled={busy}>
            {busy ? 'Хадгалж байна…' : 'Үйлчилгээ нэмэх'}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => setOpen(false)}>
            Цуцлах
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * What a customer pays through QPay to confirm a booking. Until it's set,
 * online booking is off; a change applies to new bookings only.
 */
function BookingFeeCard({ bookingFee }: { bookingFee: number | null }) {
  const router = useRouter()
  const [value, setValue] = useState(bookingFee === null ? '' : String(munguToTugrik(bookingFee)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  return (
    <form
      className="adm__card adm__pad bka-side"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        setSaved(false)
        const mungu = parseTugrik(value)
        if (mungu === undefined || mungu < 100) return setError('Дор хаяж 1₮, бүхэл тоо')
        setBusy(true)
        try {
          await adminBookingApi.setBookingFee(mungu)
          setSaved(true)
          await router.invalidate()
        } catch (err) {
          setError(errorText(err, 'Хадгалахад алдаа гарлаа'))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="bka-side__head">
        <h2>Захиалгын төлбөр</h2>
        {bookingFee === null ? (
          <span className="badge2" data-tone="dead">
            Онлайн захиалга хаалттай
          </span>
        ) : (
          <span className="badge2" data-tone="done">
            Онлайн захиалга нээлттэй
          </span>
        )}
      </div>

      <label className="field">
        <span>QPay-р урьдчилж төлөх дүн (₮)</span>
        <input value={value} inputMode="numeric" onChange={(e) => setValue(e.target.value)} />
        <small>{bookingFee === null ? 'Тохируулаагүй — онлайн захиалга хаалттай байна.' : `Одоо: ${formatMnt(bookingFee)}`}</small>
      </label>
      <p className="adm__muted bka-note">Шинэ захиалгад үйлчилнө. Өмнөх захиалгууд төлсөн дүнгээ хадгална. Урьдчилгаа буцаагдахгүй.</p>

      {error && <p className="error">{error}</p>}

      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Хадгалж байна…' : saved ? '✓ Хадгалсан' : 'Хадгалах'}
      </button>
    </form>
  )
}
