import { createFileRoute, Link } from '@tanstack/react-router'
import { formatMnt } from '~/lib/money'
import { getProducts } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/products/')({
  loader: () => getProducts(),
  component: Products,
})

const LOW = 10

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
                  <span
                    className="pill"
                    data-tone={
                      product.stock === 0
                        ? 'out'
                        : product.stock <= LOW
                          ? 'low'
                          : undefined
                    }
                  >
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
