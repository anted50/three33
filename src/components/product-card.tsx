import { Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import type { ProductCard as ProductCardData } from '~/lib/server/products/queries'

/**
 * Only marks stock when it is a problem.
 *
 * "Бэлэн" on every card was noise — in a shop that stocks what it lists, "in
 * stock" is the default and says nothing. "Дууссан" stays, because that is the
 * one state worth interrupting for: without it a customer clicks into a
 * product, picks a size, and only then finds they cannot buy it.
 */
export function StockPill({ stock }: { stock: number }) {
  if (stock > 0) return null

  return (
    <span className="pill" data-tone="out">
      Дууссан
    </span>
  )
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link to="/products/$slug" params={{ slug: product.slug }} className="card">
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
        <span className="card__price">{formatMnt(product.fromPrice)}</span>
      </div>
    </Link>
  )
}
