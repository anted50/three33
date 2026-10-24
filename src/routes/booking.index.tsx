import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { BookingBar, BookingShell, BookingTitle, useIsDesktop } from '~/components/booking/shell'
import { CheckIcon, PhoneIcon, PlusIcon, ScissorsIcon } from '~/components/booking/icons'
import { DayPicker } from '~/components/booking/day-picker'
import { TimeGrid } from '~/components/booking/time-grid'
import { DateTile, SummaryCard, whenLine } from '~/components/booking/summary'
import { BookingApiError, bookingApi } from '~/lib/booking/api'
import type { BookableService } from '~/lib/booking/api'
import { dayTitle, formatDuration, slotTime, todayUb } from '~/lib/booking/calendar'
import { heldBooking, rememberBooking } from '~/lib/booking/held'
import { SHOP } from '~/lib/booking/shop'
import { formatMnt } from '~/lib/money'

/**
 * Service → time → details, then the QPay fee on /booking/$bookingNo.
 *
 * Every choice lives in the URL, so the phone's back button walks back
 * through the steps and a refresh loses nothing. Phones show one step per
 * screen; desktop shows service and time side by side (booking.css).
 */

/** How far ahead the calendar reaches — the API's maximum per request. */
const SLOT_DAYS = 31

const searchSchema = z.object({
  service: z.uuid().optional().catch(undefined),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  time: z.iso.datetime({ offset: true }).optional().catch(undefined),
  step: z.enum(['service', 'time', 'details']).optional().catch(undefined),
  /** A slot someone else took while this customer was filling in the form. */
  taken: z.iso.datetime({ offset: true }).optional().catch(undefined),
})

type Search = z.infer<typeof searchSchema>

export const Route = createFileRoute('/booking/')({
  // Talks to /api/v1/public from the browser; nothing to render on the server.
  ssr: false,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ service: search.service }),
  loader: async ({ deps }) => {
    const options = await bookingApi.options()
    const service = options.services.find((s) => s.id === deps.service)
    const slots = service && options.bookingFee !== null ? await bookingApi.slots(service.id, todayUb(), SLOT_DAYS) : null
    return { options, slots }
  },
  component: BookingFlow,
  pendingComponent: BookingLoading,
  errorComponent: BookingFailed,
})

interface Form {
  name: string
  phone: string
  email: string
  note: string
}

type FormErrors = Partial<Record<keyof Form, string>>

/** Mirrors the API's own rules (api/input.ts), so most mistakes never leave the page. */
function validate(form: Form): FormErrors {
  const errors: FormErrors = {}
  if (!form.name.trim()) errors.name = 'Нэрээ оруулна уу'
  if (!/^\d{8}$/.test(form.phone.replace(/\s/g, ''))) errors.phone = '8 оронтой дугаар оруулна уу'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'И-мэйл хаяг буруу байна'
  return errors
}

function BookingFlow() {
  const { options, slots } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const desktop = useIsDesktop()

  const [form, setForm] = useState<Form>({ name: '', phone: '', email: '', note: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [problem, setProblem] = useState<'hold' | 'failed' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (options.bookingFee === null) return <BookingClosed />
  const fee = options.bookingFee

  const service = options.services.find((s) => s.id === search.service) ?? null
  const days = slots?.days ?? []
  const open = new Set(days.filter((d) => d.slots.length > 0).map((d) => d.date))
  const date = search.date && days.some((d) => d.date === search.date) ? search.date : (days.find((d) => d.slots.length > 0)?.date ?? null)
  const daySlots = days.find((d) => d.date === date)?.slots ?? []
  // Only a time that is free right now counts — a stale or shared link may
  // name one that's gone. Compared as instants: the URL may spell it differently.
  const wanted = search.time ? new Date(search.time).getTime() : null
  const time = service && wanted !== null ? (daySlots.find((s) => new Date(s).getTime() === wanted) ?? null) : null
  const endsAt = time && service ? new Date(new Date(time).getTime() + service.durationMinutes * 60_000).toISOString() : null

  const requested = search.step ?? (service ? 'time' : 'service')
  const step = !service ? 'service' : requested === 'details' && !time ? 'time' : requested

  /** Choices within a step replace the history entry; moving between steps pushes one. */
  const go = (patch: Partial<Search>, replace = false) =>
    navigate({ search: (prev: Search) => ({ ...prev, ...patch }), replace })

  const pickService = (s: BookableService) =>
    go({ service: s.id, date: undefined, time: undefined, taken: undefined, step: desktop ? 'time' : 'service' }, true)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!service || !time || submitting) return
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    setProblem(null)
    try {
      const created = await bookingApi.create({
        serviceId: service.id,
        startsAt: time,
        customerName: form.name.trim(),
        customerPhone: form.phone.replace(/\s/g, ''),
        customerEmail: form.email.trim(),
        note: form.note.trim() || null,
      })
      rememberBooking({ bookingNo: created.bookingNo, token: created.token, email: form.email.trim().toLowerCase() })
      await navigate({ to: '/booking/$bookingNo', params: { bookingNo: created.bookingNo }, search: { t: created.token } })
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'UNKNOWN'
      if (code === 'TIME_TAKEN' || code === 'NOT_AVAILABLE' || (error instanceof BookingApiError && error.status === 400 && code !== 'VALIDATION')) {
        // Someone got there first (or the time passed): fresh slots, back to the times.
        await router.invalidate()
        go({ step: 'time', time: undefined, taken: time })
      } else if (code === 'HOLD_EXISTS') {
        setProblem('hold')
      } else if (code === 'BOOKING_OFF') {
        await router.invalidate()
      } else {
        setProblem('failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const bar =
    step === 'details' ? (
      <BookingBar
        type="submit"
        form="bk-details"
        tone="red"
        label={submitting ? 'Төлбөр үүсгэж байна…' : 'QPay-р төлөх'}
        value={formatMnt(fee)}
        disabled={submitting}
      />
    ) : step === 'service' && !desktop ? (
      <BookingBar
        label={service ? 'Цаг сонгох' : 'Үйлчилгээ сонгоно уу'}
        value={service ? formatDuration(service.durationMinutes) : undefined}
        disabled={!service}
        onClick={() => go({ step: 'time' })}
      />
    ) : (
      <BookingBar
        label={desktop ? 'Үргэлжлүүлэх' : 'Захиалга харах'}
        value={formatMnt(fee)}
        disabled={!time}
        onClick={() => go({ step: 'details' })}
      />
    )

  return (
    <BookingShell>
      <div className="bk-flow" data-step={step}>
        <div className="bk-flow__main">
          {step === 'details' && service && time && endsAt ? (
            <form id="bk-details" className="bk-sec" onSubmit={submit} noValidate>
              <BookingTitle onBack={() => go({ step: 'time' })}>Таны мэдээлэл</BookingTitle>

              <div className="bk-card bk-row bk-only-mobile">
                <DateTile startsAt={time} />
                <div>
                  <div className="bk-row__v">{service.name}</div>
                  <div className="bk-row__k">{whenLine(time, endsAt)}</div>
                </div>
              </div>

              <div className="bk-fields">
                <Field label="Нэр" error={errors.name}>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    autoComplete="name"
                    maxLength={120}
                  />
                </Field>
                <Field label="Утас" error={errors.phone}>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={9}
                  />
                </Field>
                <Field label="И-мэйл" error={errors.email} wide>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    autoComplete="email"
                    maxLength={255}
                  />
                </Field>
                <Field label="Тэмдэглэл" wide>
                  <input
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="Заавал биш"
                    maxLength={500}
                  />
                </Field>
              </div>

              {problem === 'hold' && <HoldExists />}
              {problem === 'failed' && (
                <div className="bk-alert" role="alert">
                  <b>Төлбөр эхлүүлж чадсангүй</b>
                  <span>Цаг тань хадгалагдаагүй. Хэсэг хүлээгээд дахин оролдоно уу.</span>
                </div>
              )}

              <p className="bk-fine bk-only-mobile">
                {formatMnt(fee)} урьдчилгаа буцаагдахгүй.
                {service.price !== null && ` Үйлчилгээний ${formatMnt(service.price)}-ийг газар дээр нь төлнө.`}
              </p>
            </form>
          ) : (
            <>
              <section className="bk-sec bk-sec--service">
                <BookingTitle sub={`${SHOP.name} · нэг сандал`}>Үйлчилгээ сонгох</BookingTitle>
                <ul className="bk-services">
                  {options.services.map((s) => {
                    const on = s.id === service?.id
                    return (
                      <li key={s.id}>
                        <button type="button" className="bk-service" aria-pressed={on} onClick={() => pickService(s)}>
                          <span className="bk-service__text">
                            <span className="bk-service__name">{s.name}</span>
                            <span className="bk-service__meta">
                              {formatDuration(s.durationMinutes)}
                              {s.price !== null && ` · ${formatMnt(s.price)}`}
                            </span>
                          </span>
                          <span className="bk-add" data-on={on}>
                            {on ? <CheckIcon /> : <PlusIcon />}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section className="bk-sec bk-sec--time">
                <BookingTitle onBack={desktop ? undefined : () => go({ step: 'service' })}>Цаг сонгох</BookingTitle>
                {!service ? (
                  <p className="bk-muted bk-empty">Эхлээд үйлчилгээгээ сонгоно уу.</p>
                ) : open.size === 0 ? (
                  <div className="bk-empty">
                    <p>Ойрын {SLOT_DAYS} хоногт сул цаг алга.</p>
                    <p className="bk-muted">
                      Утсаар холбогдоно уу: <a href={SHOP.tel}>{SHOP.phone}</a>
                    </p>
                  </div>
                ) : (
                  <div className="bk-when">
                    <DayPicker
                      dates={days.map((d) => d.date)}
                      open={open}
                      selected={date}
                      onSelect={(d) => go({ date: d, time: undefined, taken: undefined }, true)}
                    />
                    <div className="bk-when__times">
                      {search.taken && (
                        <div className="bk-alert" role="alert">
                          <b>{slotTime(search.taken)} дөнгөж сая захиалагдлаа</b>
                          <span>Өөр цаг сонгоно уу.</span>
                        </div>
                      )}
                      {date && (
                        <>
                          <div className="bk-dayhead">
                            <h3>{dayTitle(date)}</h3>
                            <p>{daySlots.length} сул цаг</p>
                          </div>
                          <TimeGrid slots={daySlots} selected={time} onSelect={(slot) => go({ time: slot, taken: undefined }, true)} />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <SummaryCard service={service?.name ?? null} startsAt={time} endsAt={endsAt} price={service?.price ?? null} fee={fee}>
          {bar}
        </SummaryCard>
      </div>
    </BookingShell>
  )
}

function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className="bk-field" data-invalid={Boolean(error)} data-wide={wide}>
      <span className="bk-field__label">{label}</span>
      {children}
      {error && <span className="bk-field__error">{error}</span>}
    </label>
  )
}

/** HOLD_EXISTS: one unpaid booking per phone/email at a time. Point at it. */
function HoldExists() {
  const held = heldBooking()
  return (
    <div className="bk-alert" role="alert">
      <b>Танд төлбөр хүлээж буй захиалга байна</b>
      <span>
        Энэ утас эсвэл и-мэйлээр 15 минутын дотор хадгалсан цаг бий.{' '}
        {held ? (
          <Link to="/booking/$bookingNo" params={{ bookingNo: held.bookingNo }} search={{ t: held.token }}>
            Түүнийг төлөх
          </Link>
        ) : (
          'Түүнийгээ төлөх эсвэл хугацаа дуусахыг хүлээнэ үү.'
        )}
      </span>
    </div>
  )
}

/** No booking fee set: online booking is off. Phone instead. */
function BookingClosed() {
  return (
    <BookingShell>
      <div className="bk-center">
        <ScissorsIcon />
        <h2 className="bk-center__title">Онлайн захиалга түр хаалттай</h2>
        <p className="bk-muted">Цаг авах бол утсаар холбогдоно уу.</p>
        <div className="bk-center__actions">
          <BookingBar
            href={SHOP.tel}
            label={
              <>
                <PhoneIcon size={18} /> Залгах
              </>
            }
            value={SHOP.phone}
          />
        </div>
      </div>
    </BookingShell>
  )
}

function BookingLoading() {
  return (
    <BookingShell>
      <div className="bk-flow">
        <div className="bk-flow__main">
          <div className="bk-skeleton" aria-busy="true" aria-label="Ачаалж байна" />
        </div>
      </div>
    </BookingShell>
  )
}

function BookingFailed() {
  const router = useRouter()
  return (
    <BookingShell>
      <div className="bk-center">
        <h2 className="bk-center__title">Ачаалж чадсангүй</h2>
        <p className="bk-muted">Интернэт холболтоо шалгаад дахин оролдоно уу.</p>
        <div className="bk-center__actions">
          <BookingBar label="Дахин оролдох" onClick={() => router.invalidate()} />
        </div>
      </div>
    </BookingShell>
  )
}
