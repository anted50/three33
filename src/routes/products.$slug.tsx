import { useState } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { StockPill } from '~/components/product-card'
import { formatMnt } from '~/lib/money'
import { getProduct } from '~/lib/server/products/queries'

export const Route = createFileRoute('/products/$slug')({
  loader: async ({ params }) => {
    const product = await getProduct({ data: { slug: params.slug } })
    if (!product) throw notFound()
    return product
  },
  component: ProductDetail,
  notFoundComponent: () => (
    <Page>
      <div className="wrap">
        <p className="empty">
          Бүтээгдэхүүн олдсонгүй. <Link to="/products">Бүгдийг үзэх</Link>
        </p>
      </div>
    </Page>
  ),
})

function ProductDetail() {
  const product = Route.useLoaderData()

  // Default to the first variant that is actually buyable, so the buy button
  // isn't disabled on arrival just because the cheapest size sold out.
  const [variantId, setVariantId] = useState(
    () =>
      (product.variants.find((v) => v.stockQty > 0) ?? product.variants[0])?.id,
  )
  const [qty, setQty] = useState(1)

  const variant =
    product.variants.find((v) => v.id === variantId) ?? product.variants[0]

  if (!variant) {
    return (
      <Page>
        <div className="wrap">
          <p className="empty">Энэ бүтээгдэхүүн одоогоор борлуулалтад алга.</p>
        </div>
      </Page>
    )
  }

  const max = Math.max(variant.stockQty, 0)
  const soldOut = max === 0

  return (
    <Page>
      <div className="wrap">
        <p className="crumbs">
          <Link to="/">Нүүр</Link> ›{' '}
          <Link to="/products">Бүтээгдэхүүн</Link>
          {product.categorySlug && (
            <>
              {' '}
              ›{' '}
              <Link to="/products" search={{ category: product.categorySlug }}>
                {product.categoryName}
              </Link>
            </>
          )}
        </p>

        <div className="pdp">
          <div className="pdp__media">
            {product.images[0] ? (
              <img
                src={product.images[0].url}
                alt={product.images[0].alt ?? product.name}
              />
            ) : (
              <span className="card__ph">{product.name}</span>
            )}
          </div>

          <div>
            <h1>{product.name}</h1>
            <StockPill stock={max} />

            <p className="pdp__price">
              {formatMnt(variant.price)}
              {variant.compareAtPrice ? (
                <span className="pdp__was">
                  {formatMnt(variant.compareAtPrice)}
                </span>
              ) : null}
            </p>

            {product.variants.length > 1 && (
              <>
                <p className="label">Хэмжээ</p>
                <div className="sizes">
                  {product.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="size"
                      data-active={v.id === variant.id}
                      disabled={v.stockQty === 0}
                      onClick={() => {
                        setVariantId(v.id)
                        setQty(1)
                      }}
                    >
                      {v.size ?? v.sku}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="label">Тоо ширхэг</p>
            <div className="qty">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1 || soldOut}
                aria-label="Хасах"
              >
                −
              </button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(max, q + 1))}
                disabled={qty >= max || soldOut}
                aria-label="Нэмэх"
              >
                +
              </button>
            </div>

            <div className="buybar">
              <button type="button" className="btn" disabled>
                {soldOut ? 'Дууссан' : 'Сагсанд нэмэх'}
              </button>
            </div>
            {!soldOut && (
              <p className="crumbs">
                Сагс болон QPay төлбөр дараагийн шатанд холбогдоно.
              </p>
            )}
          </div>

          {product.description && (
            <div className="prose">
              <h2>Дэлгэрэнгүй</h2>
              <p>{product.description}</p>
              <p className="crumbs">SKU: {variant.sku}</p>
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}
