import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { BookingLoadFailed } from '~/components/admin-booking'
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
  errorComponent: BookingLoadFailed,
  component: Services,
})

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

// The API's limits (serviceInput in server/booking/services.ts), checked here
// first so the admin reads them in Mongolian.
const isDurationMinutes = (minutes: number) => Number.isInteger(minutes) && minutes >= 5 && minutes <= 600
const isSortOrder = (sortOrder: number) => Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder <= 10_000

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

/** The price field: empty is "not shown" (null); undefined when typed wrong. */
const parsePrice = (value: string) => (value.trim() === '' ? null : parseTugrik(value))

interface ServiceFields {
  name: string
  description: string
  minutes: string
  price: string
  sortOrder: string
}

/**
 * The row's edits as a PATCH: only what differs from the saved service. A
 * price typed wrong stays in it as `undefined`, so the row counts as edited
 * and patchError refuses it, instead of the edit silently doing nothing.
 */
function editedPatch(service: AdminService, fields: ServiceFields): Partial<ServiceInput> {
  const patch: Partial<ServiceInput> = {}
  const name = fields.name.trim()
  const description = fields.description.trim() || null
  const price = parsePrice(fields.price)
  if (name !== service.name) patch.name = name
  if (description !== service.description) patch.description = description
  if (fields.minutes !== String(service.durationMinutes)) patch.durationMinutes = Number(fields.minutes)
  if (price !== service.price) patch.price = price
  if (fields.sortOrder !== String(service.sortOrder)) patch.sortOrder = Number(fields.sortOrder)
  return patch
}

/** Why a patch can't be sent, or null. */
function patchError(patch: Partial<ServiceInput>): string | null {
  if (patch.name === '') return 'Нэр хоосон байна'
  if (patch.durationMinutes !== undefined && !isDurationMinutes(patch.durationMinutes)) return 'Хугацаа 5–600 минут'
  if ('price' in patch && patch.price === undefined) return 'Үнэ буруу байна'
  if (patch.sortOrder !== undefined && !isSortOrder(patch.sortOrder)) return 'Эрэмбэ буруу байна'
  return null
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

  const patch = editedPatch(service, { name, description, minutes, price, sortOrder })
  const edited = Object.keys(patch).length > 0

  async function save(changes: Partial<ServiceInput>) {
    setError(null)
    const problem = patchError(changes)
    if (problem !== null) {
      setError(problem)
      return
    }
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
          <button type="button" className="btn btn--sm" disabled={!edited || busy} onClick={() => save(patch)}>
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

type NewService = { name: string; description: string; minutes: string; price: string }

const newServiceEmpty: NewService = { name: '', description: '', minutes: '45', price: '' }

function AddServiceForm({ nextSortOrder }: { nextSortOrder: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<NewService>(newServiceEmpty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const name = draft.name.trim()
    const durationMinutes = Number(draft.minutes)
    const price = parsePrice(draft.price)
    // `required` lets a name of only spaces through; the API would refuse it.
    if (name === '') return setError('Нэр хоосон байна')
    if (!isDurationMinutes(durationMinutes)) return setError('Хугацаа 5–600 минут')
    if (price === undefined) return setError('Үнэ буруу байна')
    setBusy(true)
    try {
      await adminBookingApi.createService({ name, description: draft.description.trim() || null, durationMinutes, price, sortOrder: nextSortOrder })
      await router.invalidate()
      // The length is kept: the next service is usually about as long.
      setDraft((current) => ({ ...newServiceEmpty, minutes: current.minutes }))
      setOpen(false)
    } catch (err) {
      setError(errorText(err, 'Хадгалахад алдаа гарлаа'))
    } finally {
      setBusy(false)
    }
  }

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
      <form className="varrow" onInvalidCapture={localizeValidity} onInput={clearValidity} onSubmit={submit}>
        <NewServiceFields draft={draft} onChange={(fields) => setDraft((current) => ({ ...current, ...fields }))} />

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

function NewServiceFields({ draft, onChange }: { draft: NewService; onChange: (fields: Partial<NewService>) => void }) {
  return (
    <>
      <div className="adm__cols">
        <label className="field">
          <span>Нэр</span>
          <input value={draft.name} required maxLength={120} onChange={(e) => onChange({ name: e.target.value })} placeholder="Үс засалт" />
        </label>
        <label className="field">
          <span>Тайлбар (заавал биш)</span>
          <input value={draft.description} maxLength={2000} onChange={(e) => onChange({ description: e.target.value })} />
        </label>
      </div>
      <div className="adm__cols">
        <label className="field">
          <span>Хугацаа (минут)</span>
          <input value={draft.minutes} required inputMode="numeric" onChange={(e) => onChange({ minutes: e.target.value })} />
        </label>
        <label className="field">
          <span>Үнэ (₮, газар дээр төлнө — заавал биш)</span>
          <input value={draft.price} inputMode="numeric" onChange={(e) => onChange({ price: e.target.value })} />
        </label>
      </div>
    </>
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

  async function submit(event: React.FormEvent) {
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
  }

  function edit(text: string) {
    setValue(text)
    // "Saved" is about what is in the field; an edit since is not saved yet.
    setSaved(false)
  }

  return (
    <form className="adm__card adm__pad bka-side" onSubmit={submit}>
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
        <input value={value} inputMode="numeric" onChange={(e) => edit(e.target.value)} />
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
