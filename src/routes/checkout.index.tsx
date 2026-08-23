import { useState } from 'react'
import { useRouter, createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { useCartDrawer } from '~/components/cart-drawer'
import { formatMnt } from '~/lib/money'
import { getCart, getShippingRates } from '~/lib/server/cart/cart'
import { createOrder } from '~/lib/server/orders/create'

export const Route = createFileRoute('/checkout/')({
    loader: async () => ({
        cart: await getCart(),
        rates: await getShippingRates(),
    }),
    component: Checkout,
})

function Checkout() {
    const { cart, rates } = Route.useLoaderData()
    const { openCart } = useCartDrawer()
    const navigate = useNavigate()
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    /**
     * Computed from the server's own rates, so what is quoted here and what the
     * order is charged cannot drift. The server still recomputes at checkout —
     * this is a preview of that result, not an input to it.
     */
    const shipping = cart.subtotal >= rates.freeThreshold ? 0 : rates.fee

    if (cart.lines.length === 0) {
        return (
            <Page>
                <div className="wrap">
                    <p className="empty">
                        Сагс хоосон байхад захиалга үүсгэх боломжгүй.
                        <br />
                        <br />
                        <Link to="/products" className="btn" style={{ maxWidth: 260 }}>
                            Бүтээгдэхүүн үзэх
                        </Link>
                    </p>
                </div>
            </Page>
        )
    }

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        setBusy(true)

        const form = new FormData(event.currentTarget)

        try {
            const result = await createOrder({
                data: {
                    name: String(form.get('name') ?? ''),
                    phone: String(form.get('phone') ?? ''),
                    email: String(form.get('email') ?? ''),
                    address: String(form.get('address') ?? ''),
                    note: String(form.get('note') ?? ''),
                },
            })

            await navigate({
                to: '/checkout/payment/$orderNo',
                params: { orderNo: result.orderNo },
            })

            await router.invalidate()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Захиалга үүсгэхэд алдаа гарлаа')
            setBusy(false)
        }
    }

    return (
        <Page>
            <div className="wrap">
                <p className="crumbs">
                    {/* The cart is a drawer now, so there is no page to link back to. */}
                    <button type="button" className="linkish" onClick={openCart}>
                        Сагс
                    </button>{' '}
                    › Захиалга
                </p>

                <h1 className="page-title">Хүргэлтийн мэдээлэл</h1>

                <form onSubmit={onSubmit} className="form">
                    <label className="field">
                        <span>Нэр *</span>
                        <input name="name" required maxLength={100} autoComplete="name" />
                    </label>

                    <label className="field">
                        <span>Утас *</span>
                        <input
                            name="phone"
                            required
                            inputMode="numeric"
                            pattern="[0-9]{8}"
                            maxLength={8}
                            placeholder="99112233"
                            autoComplete="tel"
                        />
                        <small>8 оронтой дугаар</small>
                    </label>

                    <label className="field">
                        <span>И-мэйл</span>
                        <input name="email" type="email" autoComplete="email" />
                        <small>Захиалгын баримт илгээхэд ашиглана</small>
                    </label>

                    <label className="field">
                        <span>Хаяг *</span>
                        <textarea
                            name="address"
                            required
                            rows={4}
                            maxLength={500}
                            minLength={5}
                            placeholder="Дүүрэг, хороо, байр, орц, тоот — хүргэлтийн жолооч олоход хангалттай бичнэ үү"
                            autoComplete="street-address"
                        />
                    </label>

                    <label className="field">
                        <span>Тэмдэглэл</span>
                        <textarea name="note" maxLength={1000} rows={3} />
                    </label>

                    <div className="totals">
                        <div className="totals__row">
                            <span>Дүн</span>
                            <strong>{formatMnt(cart.subtotal)}</strong>
                        </div>
                        <div className="totals__row">
                            <span>Хүргэлт</span>
                            <strong>{shipping === 0 ? 'Үнэгүй' : formatMnt(shipping)}</strong>
                        </div>
                        <div className="totals__row totals__row--grand">
                            <span>Нийт</span>
                            <strong>{formatMnt(cart.subtotal + shipping)}</strong>
                        </div>
                    </div>

                    {error && <p className="error">{error}</p>}

                    <div className="buybar">
                        <button type="submit" className="btn" disabled={busy}>
                            {busy ? 'Түр хүлээнэ үү…' : 'Төлбөр төлөх'}
                        </button>
                    </div>
                </form>
            </div>
        </Page>
    )
}
