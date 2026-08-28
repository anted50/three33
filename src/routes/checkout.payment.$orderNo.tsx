import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { Page } from '~/components/layout'
import { formatMnt } from '~/lib/money'
import { getOrderStatus, getPaymentDetails } from '~/lib/server/orders/queries'
import { getInvoicePresentation } from '~/lib/server/orders/presentation'

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
    const details = await getPaymentDetails({
      data: { orderNo: params.orderNo, token: deps.t },
    })
    if (!details) return null
    return {
      ...details,
      invoice: await getInvoicePresentation({
        data: { orderNo: params.orderNo, token: deps.t },
      }),
    }
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

function pollDelay(tick: number): number {
  return POLL_STEPS_MS[tick] ?? POLL_MAX_MS
}

function Payment() {
  const data = Route.useLoaderData()
  const { orderNo } = Route.useParams()
  const { t } = Route.useSearch()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string>(data?.status ?? 'unknown')
  const [now, setNow] = useState(() => Date.now())

  const expiresAt = data?.expiresAt ?? null
  const expired = expiresAt !== null && now >= expiresAt

  // Drives the countdown. Separate from the poll so the clock stays smooth
  // while the poll interval stretches.
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  const tick = useRef(0)

  useEffect(() => {
    if (status !== 'pending_payment') return
    if (expiresAt !== null && Date.now() >= expiresAt) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      const result = await getOrderStatus({ data: { orderNo, token: t } })
      if (cancelled) return

      setStatus(result.status)
      if (result.status === 'paid') {
        navigate({ to: '/orders/$orderNo/success', params: { orderNo }, search: { t } })
        return
      }

      // Stop asking once the invoice can no longer be paid.
      if (expiresAt !== null && Date.now() >= expiresAt) return

      timer = setTimeout(poll, pollDelay(tick.current++))
    }

    timer = setTimeout(poll, pollDelay(tick.current++))

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [status, orderNo, navigate, expiresAt, t])

  if (!data) {
    return (
      <Page>
        <div className="wrap">
          <p className="empty">Захиалга олдсонгүй.</p>
        </div>
      </Page>
    )
  }

  if (status !== 'pending_payment') {
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

  /**
   * The invoice lapsed. Saying so beats letting them scan a QR the bank will
   * reject — and starting again actually works now, because the cart was never
   * emptied at checkout.
   */
  if (expired) {
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

  const invoice = data.invoice

  return (
    <Page>
      <div className="wrap pay">
        <h1 className="page-title">Төлбөр төлөх</h1>
        <p className="crumbs">
          Захиалга {orderNo} · {formatMnt(data.amount)}
        </p>

        {expiresAt !== null && (
          <p className="crumbs">
            Төлөх хугацаа: <Countdown msLeft={expiresAt - now} />
          </p>
        )}

        {/*
          Mobile first, and not just as layout. On a phone the bank list IS the
          checkout: tap your bank, the app opens with the amount filled in, pay,
          come back. The QR below is the desktop path — you cannot scan a code
          with the same phone that is displaying it.
        */}
        {invoice && invoice.links.length > 0 && (
          <section className="banks">
            <p className="label">Банкны аппаар төлөх</p>
            <ul className="banks__list">
              {invoice.links.map((link) => (
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
        )}

        {invoice?.qrImage && (
          <section className="qr">
            <p className="label">Эсвэл QR уншуулах</p>
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
        )}

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

function Countdown({ msLeft }: { msLeft: number }) {
  const total = Math.max(0, Math.floor(msLeft / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  return (
    <strong>
      {minutes}:{String(seconds).padStart(2, '0')}
    </strong>
  )
}
