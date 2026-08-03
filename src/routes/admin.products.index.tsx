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
        <span className="adm__muted">{products.length} бүтээгдэхүүн</span>
      </header>

      <section className="adm__card">
        <table className="adm__table">
          <thead>
            <tr>
              <th>Нэр</th>
              <th>Ангилал</th>
              <th>Хувилбар</th>
              <th>Нөөц</th>
              <th>Үнэ</th>
              <th>Төлөв</th>
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
                <td className="adm__muted">{product.category ?? '—'}</td>
                <td>{product.variants}</td>
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
                <td>{formatMnt(product.minPrice)}</td>
                <td>
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
