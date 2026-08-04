import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Page } from '~/components/layout'
import { ProductCard } from '~/components/product-card'
import { SearchBox } from '~/components/search-box'
import { listCategories, listProducts } from '~/lib/server/products/queries'

/** Filter state lives in the URL, so a filtered or searched list is shareable. */
const searchSchema = z.object({
  category: z.string().max(64).optional(),
  q: z.string().max(64).optional(),
})

export const Route = createFileRoute('/products/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ category: search.category, q: search.q }),
  loader: async ({ deps }) => ({
    categories: await listCategories(),
    products: await listProducts({
      data: { category: deps.category, q: deps.q },
    }),
  }),
  component: Listing,
})

function Listing() {
  const { categories, products } = Route.useLoaderData()
  const { category, q } = Route.useSearch()

  const active = categories.find((c) => c.slug === category)

  return (
    <Page>
      <div className="wrap">
        <p className="crumbs">
          <Link to="/">Нүүр</Link> ›{' '}
          {q ? `"${q}" хайлт` : active ? active.nameMn : 'Бүтээгдэхүүн'}
        </p>

        <SearchBox />

        <div className="chips">
          <Link
            to="/products"
            // Keep the query when switching category, drop the category.
            search={(prev) => ({ ...prev, category: undefined })}
            className="chip"
            data-active={!category}
          >
            Бүгд
          </Link>
          {categories.map((c) => (
            <Link
              key={c.slug}
              to="/products"
              search={(prev) => ({ ...prev, category: c.slug })}
              className="chip"
              data-active={category === c.slug}
            >
              {c.nameMn}
            </Link>
          ))}
        </div>

        {products.length === 0 ? (
          <div className="empty">
            {q ? (
              <>
                <p>
                  <strong>"{q}"</strong> хайлтад тохирох бүтээгдэхүүн олдсонгүй.
                </p>
                <p className="crumbs" style={{ marginTop: 12 }}>
                  Өөр үг оруулах, эсвэл{' '}
                  <Link to="/products" search={{}}>
                    бүх бүтээгдэхүүнийг үзэх
                  </Link>
                  .
                </p>
              </>
            ) : (
              <p>Энэ ангилалд бүтээгдэхүүн олдсонгүй.</p>
            )}
          </div>
        ) : (
          <>
            <p className="crumbs">
              {products.length} бүтээгдэхүүн
              {q ? ` — "${q}"` : ''}
            </p>
            <div className="grid">
              {products.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </Page>
  )
}
