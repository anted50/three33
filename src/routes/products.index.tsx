import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Breadcrumbs } from '~/components/breadcrumbs'
import { Page } from '~/components/layout'
import { ProductCard } from '~/components/product-card'
import { ProductGroups } from '~/components/product-groups'
import {
  listCategories,
  listGroupedProducts,
  listProducts,
  type ProductCard as ProductCardData,
} from '~/lib/server/products/queries'

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
  loader: async ({ deps }) => {
    // Plain "/products", no filter — the grouped rail view. A category or a
    // search narrows it to one flat, filtered list instead, same as before.
    if (!deps.category && !deps.q) {
      return { mode: 'grouped' as const, groups: await listGroupedProducts() }
    }

    return {
      mode: 'flat' as const,
      categories: await listCategories(),
      products: await listProducts({
        data: { category: deps.category, q: deps.q, sort: deps.sort },
      }),
    }
  },
  component: Listing,
})

function Listing() {
  const data = Route.useLoaderData()

  if (data.mode === 'grouped') {
    return (
      <Page>
        <div className="wrap">
          <Breadcrumbs
            trail={[<Link to="/">Нүүр</Link>]}
            current="Бүтээгдэхүүн"
          />
          <ProductGroups groups={data.groups} />
        </div>
      </Page>
    )
  }

  return <FlatListing categories={data.categories} products={data.products} />
}

function FlatListing({
  categories,
  products,
}: {
  categories: Array<{ slug: string; nameMn: string; nameEn: string }>
  products: ProductCardData[]
}) {
  const { category, q } = Route.useSearch()
  const active = categories.find((c) => c.slug === category)
  // A search or a known category is a step under the catalogue. A category
  // slug that matches nothing (an old or mistyped link) has no name of its
  // own, so the page is the catalogue itself, not "Бүтээгдэхүүн › Бүтээгдэхүүн".
  const narrowed = q ? `"${q}" хайлт` : active ? active.nameMn : null

  return (
    <Page>
      <div className="wrap">
        {narrowed === null ? (
          <Breadcrumbs trail={[<Link to="/">Нүүр</Link>]} current="Бүтээгдэхүүн" />
        ) : (
          <Breadcrumbs
            trail={[
              <Link to="/">Нүүр</Link>,
              <Link to="/products" search={{}}>
                Бүтээгдэхүүн
              </Link>,
            ]}
            current={narrowed}
          />
        )}

        {/*
          No search field of its own: Breadcrumbs above renders the phones'
          bar, and the header has the field from 900px. One per breakpoint.
        */}

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
