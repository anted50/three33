import { Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import type { ProductCard as ProductCardData } from '~/lib/server/products/queries'

/** Below this many units we warn rather than just saying "in stock". */
const LOW_STOCK_THRESHOLD = 6

export function StockPill({ stock }: { stock: number }) {
  if (stock <= 0) {
    return (
      <span className="pill" data-tone="out">
        Дууссан
      </span>
    )
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="pill" data-tone="low">
        Үлдэгдэл {stock}
      </span>
    )
  }
  return <span className="pill">Бэлэн</span>
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link to="/products/$slug" params={{ slug: product.slug }}>
      <div className="card__media">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} />
        ) : (
          <span className="card__ph">{product.name}</span>
        )}
      </div>

      <div className="card__name">
        {product.name}
        {product.size ? ` ${product.size}` : ''}
      </div>

      <div className="card__meta">
        <StockPill stock={product.totalStock} />
        <span className="card__price">
          {product.variantCount > 1 ? 'эхлэх үнэ ' : ''}
          {formatMnt(product.fromPrice)}
        </span>
      </div>
    </Link>
  )
}
