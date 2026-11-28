import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { Page } from '~/components/layout'
import { assert } from '~/lib/assert'
import { formatCountdown } from '~/lib/countdown'
import { formatMnt } from '~/lib/money'
import { getOrderStatus, getPaymentDetails } from '~/lib/server/orders/queries'
import {
  getInvoicePresentation,
  type InvoicePresentation,
} from '~/lib/server/orders/presentation'
import { PAYMENT_METHOD_LOGOS } from '~/lib/payment-methods'

/**
 * `?t=` carries the order's access token for the case where the checkout cookie
 * never arrived — a payment link opened on a second device, or a browser that
 * dropped it. Normally absent, because the cookie is the usual proof.
 */
const paymentSearch = z.object({ t: z.string().max(200).optional() })

export const Route = createFileRoute('/checkout/payment/$orderNo')({
  validateSearch: paymentSearch,
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ params, deps }) => {
    const input = { data: { orderNo: params.orderNo, token: deps.t } }
    // Both read our own rows, never the provider, and each checks access on
    // its own, so they can run side by side.
    const [details, invoice] = await Promise.all([
      getPaymentDetails(input),
      getInvoicePresentation(input),
    ])
    if (!details) return null
    return { ...details, invoice }
  },
  component: Payment,
})

/**
 * Poll cadence, backing off.
 *
 * Every poll of a pending order costs one QPay /payment/check. Fast at first,
 * because a customer who has just tapped their bank app is watching; slower
 * after that, because someone who left the page open is not. settleOrder
 * enforces its own floor server-side regardless of what this asks for.
 */
const POLL_STEPS_MS = [3000, 3000, 3000, 3000, 3000, 6000, 6000, 12000]
const POLL_MAX_MS = 15000

/**
 * A backstop, not the usual stop: polling ends when the invoice expires. A
 * two-hour invoice at the slowest cadence is 480 polls, so this is only
 * reached if the expiry check is somehow never true.
 */
const POLL_ATTEMPTS_MAX = 600

function pollDelay(attempt: number): number {
  return POLL_STEPS_MS[attempt] ?? POLL_MAX_MS
}

function Payment() {
  const data = Route.useLoaderData()

  if (!data) return <OrderNotFound />
  if (data.status !== 'pending_payment') return <PaymentSettled />
  return <PendingPayment data={data} />
}

type PaymentData = NonNullable<Awaited<ReturnType<typeof getPaymentDetails>>> & {
  invoice: InvoicePresentation | null
}

function PendingPayment({ data }: { data: PaymentData }) {
  const { orderNo } = Route.useParams()
  const expiresAt = data.expiresAt
  const now = useClock(expiresAt)
  usePaymentPolling(expiresAt)

  /**
   * The invoice lapsed. Saying so beats letting them scan a QR the bank will
   * reject — and starting again actually works now, because the cart was never
   * emptied at checkout.
   */
  if (now >= expiresAt) return <PaymentExpired />

  const invoice = data.invoice

  return (
    <Page>
      <div className="wrap pay">
        <h1 className="page-title">Төлбөр төлөх</h1>
        <p className="crumbs">
          Захиалга {orderNo} · {formatMnt(data.amount)}
        </p>

        <p className="crumbs">
          Төлөх хугацаа: <Countdown msLeft={expiresAt - now} />
        </p>

        {invoice && invoice.links.length > 0 && <BankLinks links={invoice.links} />}
        {data.provider === 'storepay' && <StorePayNote />}
        {invoice?.qrImage && <QpayQr invoice={invoice} orderNo={orderNo} />}

        <p className="polling">
          <span className="spinner" aria-hidden /> Төлбөрийг хүлээж байна…
        </p>
        <p className="crumbs">
          Төлсний дараа энэ хуудас автоматаар шинэчлэгдэнэ. Хаачихсан бол санаа
          зоволтгүй — сагсанд тань буцаж орох холбоос үлдэнэ.
        </p>
      </div>
    </Page>
  )
}

/**
 * The current time, ticking each second until `until` has passed. Separate
 * from the poll so the countdown stays smooth while the poll interval
 * stretches, and stopped once the invoice is over so nothing keeps ticking
 * on the expired screen.
 */
function useClock(until: number): number {
  assert(Number.isFinite(until), 'an invoice always has an expiry')
  const [now, setNow] = useState(() => Date.now())
  const over = now >= until

  useEffect(() => {
    if (over) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [over])

  return now
}

/**
 * Asks the server about the order until it is paid or the invoice expires.
 *
 * Paid goes to the success page. Any other settled status reloads the route,
 * so the page renders from the loader's fresh answer instead of a copy of the
 * status kept here. A failed check is logged and the next one tried, within
 * the expiry and POLL_ATTEMPTS_MAX; unmounting stops the loop.
 */
function usePaymentPolling(expiresAt: number) {
  const { orderNo } = Route.useParams()
  const { t } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      if (cancelled) return
      // Stop asking once the invoice can no longer be paid.
      if (Date.now() >= expiresAt) return
      if (attempts >= POLL_ATTEMPTS_MAX) return
      timer = setTimeout(poll, pollDelay(attempts))
    }

    const poll = async () => {
      attempts += 1
      assert(attempts <= POLL_ATTEMPTS_MAX, 'polling is bounded')
      try {
        const result = await getOrderStatus({ data: { orderNo, token: t } })
        if (cancelled) return
        if (result.status === 'paid') {
          await navigate({ to: '/orders/$orderNo/success', params: { orderNo }, search: { t } })
          return
        }
        if (result.status !== 'pending_payment') await router.invalidate()
      } catch (error) {
        console.error('Payment status check failed', error)
      }
      schedule()
    }

    schedule()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [orderNo, t, expiresAt, navigate, router])
}

/**
 * Mobile first, and not just as layout. On a phone the bank list IS the
 * checkout: tap your bank, the app opens with the amount filled in, pay,
 * come back. The QR below is the desktop path — you cannot scan a code
 * with the same phone that is displaying it.
 */
function BankLinks({ links }: { links: InvoicePresentation['links'] }) {
  return (
    <section className="banks">
      <p className="label">Банкны аппаар төлөх</p>
      <ul className="banks__list">
        {links.map((link) => (
          <li key={link.name}>
            <a href={link.link} className="bank">
              {link.logo ? (
                <img src={link.logo} alt="" width={36} height={36} loading="lazy" />
              ) : (
                <span className="bank__dot" />
              )}
              <span>{link.description || link.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * StorePay has nothing to scan or tap: the invoice was sent to the
 * phone number from checkout and waits in the customer's StorePay app.
 */
function StorePayNote() {
  return (
    <section className="qr">
      <p className="label">
        <img
          src={PAYMENT_METHOD_LOGOS.storepay}
          alt=""
          width={18}
          height={18}
          className="qr__provider-logo"
        />
        StorePay аппаар баталгаажуулах
      </p>
      <p className="storepay-steps">
        Таны утасны дугаарт StorePay нэхэмжлэх илгээгдлээ. StorePay апп-аа
        нээж, «Хүлээгдэж буй» нэхэмжлэхээ баталгаажуулна уу.
      </p>
    </section>
  )
}

function QpayQr({
  invoice,
  orderNo,
}: {
  invoice: InvoicePresentation
  orderNo: string
}) {
  return (
    <section className="qr">
      <p className="label">
        <img
          src={PAYMENT_METHOD_LOGOS.qpay}
          alt=""
          width={18}
          height={18}
          className="qr__provider-logo"
        />
        Эсвэл QR уншуулах
      </p>
      <img
        src={`data:image/png;base64,${invoice.qrImage}`}
        alt={`QPay QR — ${orderNo}`}
        width={240}
        height={240}
      />
      {invoice.shortUrl && (
        <p className="crumbs">
          <a href={invoice.shortUrl}>{invoice.shortUrl}</a>
        </p>
      )}
    </section>
  )
}

function Countdown({ msLeft }: { msLeft: number }) {
  return <strong>{formatCountdown(msLeft)}</strong>
}

function OrderNotFound() {
  return (
    <Page>
      <div className="wrap">
        <p className="empty">Захиалга олдсонгүй.</p>
      </div>
    </Page>
  )
}

/** Paid, cancelled or expired before this page loaded: point at the order. */
function PaymentSettled() {
  const { orderNo } = Route.useParams()
  const { t } = Route.useSearch()
  return (
    <Page>
      <div className="wrap">
        <p className="empty">
          Энэ захиалгын төлбөр аль хэдийн шийдэгдсэн байна.
          <br />
          <br />
          <Link
            to="/orders/$orderNo/success"
            params={{ orderNo }}
            search={{ t }}
            className="btn"
            style={{ maxWidth: 260 }}
          >
            Захиалга харах
          </Link>
        </p>
      </div>
    </Page>
  )
}

function PaymentExpired() {
  return (
    <Page>
      <div className="wrap">
        <p className="empty">
          Төлбөрийн хугацаа дууссан байна.
          <br />
          <br />
          Таны сагс хэвээр байгаа тул дахин захиалга үүсгэнэ үү.
          <br />
          <br />
          <Link to="/products" className="btn" style={{ maxWidth: 260 }}>
            Дэлгүүр рүү буцах
          </Link>
        </p>
      </div>
    </Page>
  )
}
