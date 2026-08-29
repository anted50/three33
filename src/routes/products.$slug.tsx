import { useState } from 'react'
import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { useCartDrawer } from '~/components/cart-drawer'
import { StockPill } from '~/components/product-card'
import { formatMnt } from '~/lib/money'
import { addToCart } from '~/lib/server/cart/cart'
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
  const router = useRouter()
  const { openCart } = useCartDrawer()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default to the first variant that is actually buyable, so the buy button
  // isn't disabled on arrival just because the cheapest size sold out.
  const [variantId, setVariantId] = useState(
    () =>
      (product.variants.find((v) => v.stockQty > 0) ?? product.variants[0])?.id,
  )
  const [qty, setQty] = useState(1)

  // The gallery is product-wide: every uploaded image is browsable, and picking
  // a size never swaps the photo out from under you.
  const [imageIndex, setImageIndex] = useState(0)
  const activeImage = product.images[imageIndex] ?? product.images[0]

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
          <div className="pdp__gallery">
            <div className="pdp__media">
              {activeImage ? (
                <img
                  src={activeImage.url}
                  alt={activeImage.alt ?? product.name}
                />
              ) : (
                <span className="card__ph">{product.name}</span>
              )}
            </div>

            {product.images.length > 1 && (
              <div className="pdp__thumbs">
                {product.images.map((image, index) => (
                  <button
                    key={`${image.url}-${index}`}
                    type="button"
                    className="pdp__thumb"
                    data-active={index === imageIndex}
                    aria-label={`Зураг ${index + 1}`}
                    onClick={() => setImageIndex(index)}
                  >
                    <img src={image.url} alt={image.alt ?? ''} loading="lazy" />
                  </button>
                ))}
              </div>
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

            {error && <p className="error">{error}</p>}

            <div className="buybar">
              <button
                type="button"
                className="btn"
                disabled={soldOut || adding}
                onClick={async () => {
                  setError(null)
                  setAdding(true)
                  try {
                    await addToCart({ data: { variantId: variant.id, qty } })
                    // Invalidate so the header badge picks up the new count.
                    await router.invalidate()
                    // Drawer instead of navigating away — you stay on the
                    // product you were looking at.
                    openCart()
                    setAdding(false)
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : 'Нэмэхэд алдаа гарлаа',
                    )
                    setAdding(false)
                  }
                }}
              >
                {soldOut
                  ? 'Дууссан'
                  : adding
                    ? 'Нэмж байна…'
                    : 'Сагсанд нэмэх'}
              </button>
            </div>
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
