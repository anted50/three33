import { createFileRoute, Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import { getProducts } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/products/')({
  loader: () => getProducts(),
  component: Products,
})

/** At or under this many in stock, the count is flagged as running low. */
const LOW_STOCK_QUANTITY = 10

function stockTone(stockQuantity: number): 'out' | 'low' | undefined {
  if (stockQuantity === 0) return 'out'
  if (stockQuantity <= LOW_STOCK_QUANTITY) return 'low'
  return undefined
}

function Products() {
  const products = Route.useLoaderData()

  return (
    <>
      <header className="adm__head">
        <h1>Бүтээгдэхүүн</h1>
        <div className="adm__headactions">
          <span className="adm__muted">{products.length} бүтээгдэхүүн</span>
          <Link to="/admin/products/new" className="btn btn--sm">
            + Шинэ бүтээгдэхүүн
          </Link>
        </div>
      </header>

      <section className="adm__card">
        <table className="adm__table adm__table--fit">
          <thead>
            <tr>
              <th>Нэр</th>
              <th className="adm__wide">Ангилал</th>
              <th className="adm__wide">Хувилбар</th>
              <th>Нөөц</th>
              <th>Үнэ</th>
              <th className="adm__wide">Төлөв</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="adm__muted">
                  Бүтээгдэхүүн алга.
                </td>
              </tr>
            )}
            {products.map((product) => (
              <tr key={product.slug}>
                <td>
                  <Link
                    to="/admin/products/$slug"
                    params={{ slug: product.slug }}
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="adm__muted adm__wide">{product.category ?? '—'}</td>
                <td className="adm__wide">{product.variants}</td>
                <td>
                  <span className="pill" data-tone={stockTone(product.stock)}>
                    {product.stock}
                  </span>
                </td>
                <td className="adm__num">{formatMnt(product.minPrice)}</td>
                <td className="adm__wide">
                  <span
                    className="badge2"
                    data-tone={product.status === 'active' ? 'ok' : 'dead'}
                  >
                    {product.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
