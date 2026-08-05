import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Page, SortTabs } from '~/components/layout'
import { ProductCard } from '~/components/product-card'
import { listCategories, listProducts } from '~/lib/server/products/queries'

/** Filter state lives in the URL, so a filtered or searched list is shareable. */
const searchSchema = z.object({
  category: z.string().max(64).optional(),
  q: z.string().max(64).optional(),
  sort: z.enum(['featured', 'new', 'bestseller']).optional(),
})

export const Route = createFileRoute('/products/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    category: search.category,
    q: search.q,
    sort: search.sort,
  }),
  loader: async ({ deps }) => ({
    categories: await listCategories(),
    products: await listProducts({
      data: { category: deps.category, q: deps.q, sort: deps.sort },
    }),
  }),
  component: Listing,
})

function Listing() {
  const { categories, products } = Route.useLoaderData()
  const { category, q, sort } = Route.useSearch()

  const active = categories.find((c) => c.slug === category)

  return (
    <Page>
      <div className="wrap">
        <p className="crumbs">
          <Link to="/">Нүүр</Link> ›{' '}
          {q ? `"${q}" хайлт` : active ? active.nameMn : 'Бүтээгдэхүүн'}
        </p>

        {/*
          No search field here — the header owns search at both breakpoints
          (inline on desktop, toggled panel on mobile). Rendering one here too
          put two search bars on the same desktop page.
        */}
        <SortTabs current={sort} />

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
