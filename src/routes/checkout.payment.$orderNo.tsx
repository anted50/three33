import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { formatMnt } from '~/lib/money'
import { getOrderStatus, getPaymentDetails } from '~/lib/server/orders/queries'
import { getInvoicePresentation } from '~/lib/server/orders/presentation'

export const Route = createFileRoute('/checkout/payment/$orderNo')({
  loader: async ({ params }) => {
    const details = await getPaymentDetails({ data: { orderNo: params.orderNo } })
    if (!details) return null
    return {
      ...details,
      invoice: await getInvoicePresentation({
        data: { orderNo: params.orderNo },
      }),
    }
  },
  component: Payment,
})

/** Poll cadence. Fast enough to feel immediate, slow enough not to hammer QPay. */
const POLL_MS = 3000

function Payment() {
  const data = Route.useLoaderData()
  const { orderNo } = Route.useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string>(data?.status ?? 'unknown')

  useEffect(() => {
    if (status !== 'pending_payment') return

    let cancelled = false
    const timer = setInterval(async () => {
      const result = await getOrderStatus({ data: { orderNo } })
      if (cancelled) return

      setStatus(result.status)
      if (result.status === 'paid') {
        clearInterval(timer)
        navigate({ to: '/orders/$orderNo/success', params: { orderNo } })
      }
    }, POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status, orderNo, navigate])

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
            <Link to="/orders/$orderNo/success" params={{ orderNo }} className="btn" style={{ maxWidth: 260 }}>
              Захиалга харах
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
                      <img src={link.logo} alt="" width={28} height={28} loading="lazy" />
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
          Төлсний дараа энэ хуудас автоматаар шинэчлэгдэнэ. Хаачихсан бол
          санаа зоволтгүй — төлбөр баталгаажмагц захиалга бүртгэгдэнэ.
        </p>
      </div>
    </Page>
  )
}
