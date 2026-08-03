import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Page } from '~/components/layout'
import { ProductCard } from '~/components/product-card'
import { listCategories, listProducts } from '~/lib/server/products/queries'

/** Filter state lives in the URL, so a filtered list is shareable. */
const searchSchema = z.object({
  category: z.string().max(64).optional(),
})

export const Route = createFileRoute('/products/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ category: search.category }),
  loader: async ({ deps }) => ({
    categories: await listCategories(),
    products: await listProducts({ data: { category: deps.category } }),
  }),
  component: Listing,
})

function Listing() {
  const { categories, products } = Route.useLoaderData()
  const { category } = Route.useSearch()

  const active = categories.find((c) => c.slug === category)

  return (
    <Page>
      <div className="wrap">
        <p className="crumbs">
          <Link to="/">Нүүр</Link> › {active ? active.nameMn : 'Бүтээгдэхүүн'}
        </p>

        <div className="chips">
          <Link
            to="/products"
            search={{}}
            className="chip"
            data-active={!category}
          >
            Бүгд
          </Link>
          {categories.map((c) => (
            <Link
              key={c.slug}
              to="/products"
              search={{ category: c.slug }}
              className="chip"
              data-active={category === c.slug}
            >
              {c.nameMn}
            </Link>
          ))}
        </div>

        {products.length === 0 ? (
          <p className="empty">Энэ ангилалд бүтээгдэхүүн олдсонгүй.</p>
        ) : (
          <>
            <p className="crumbs">{products.length} бүтээгдэхүүн</p>
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
