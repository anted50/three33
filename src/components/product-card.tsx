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

/**
 * Sold-out flag laid over the photo, top right.
 *
 * On the image rather than beside the price because that is where the eye
 * already is when scanning a grid — a tag down in the metadata row competes
 * with the price for the same glance.
 */
function SoldOutFlag({ stock }: { stock: number }) {
  if (stock > 0) return null
  return <span className="card__flag">Дууссан</span>
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
        <SoldOutFlag stock={product.totalStock} />
      </div>

      <div className="card__name">
        {product.name}
        {product.size ? ` ${product.size}` : ''}
      </div>

      <div className="card__meta">
        <span className="card__price" data-out={product.totalStock <= 0}>
          {formatMnt(product.fromPrice)}
        </span>
      </div>
    </Link>
  )
}
