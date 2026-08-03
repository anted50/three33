import { createFileRoute, Link } from '@tanstack/react-router'
import { Page } from '~/components/layout'
import { ProductCard } from '~/components/product-card'
import { listCategories, listProducts } from '~/lib/server/products/queries'

export const Route = createFileRoute('/')({
  loader: async () => ({
    categories: await listCategories(),
    products: await listProducts({ data: {} }),
  }),
  component: Home,
})

function Home() {
  const { categories, products } = Route.useLoaderData()
  const featured = products.slice(0, 8)

  return (
    <Page>
      <section className="hero">
        <div className="wrap">
          <h1>Uppercut Deluxe Монгол</h1>
          <p>
            Австралийн мэргэжлийн үс засалтын брэнд. Three 33 Barbershop-ийн
            албан ёсны борлуулалт.
          </p>
        </div>
      </section>

      <div className="wrap">
        <div className="chips">
          {categories.map((category) => (
            <Link
              key={category.slug}
              to="/products"
              search={{ category: category.slug }}
              className="chip"
            >
              {category.nameMn}
            </Link>
          ))}
        </div>

        <div className="section-head">
          <h2>Онцлох бүтээгдэхүүн</h2>
          <Link to="/products">Бүгдийг үзэх →</Link>
        </div>

        <div className="grid">
          {featured.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      </div>
    </Page>
  )
}
