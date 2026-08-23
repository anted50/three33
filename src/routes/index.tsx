import { createFileRoute, Link } from '@tanstack/react-router'
import { HeroAscii } from '~/components/hero-ascii'
import { Page } from '~/components/layout'
import { ProductCard } from '~/components/product-card'
import { listProducts } from '~/lib/server/products/queries'

/**
 * No categories in this loader. The header's category row is fed by the root
 * loader on every page, so fetching them again here was a second query for a
 * second copy of the same nav — which is the duplication the chip row below the
 * hero represented on screen.
 */
export const Route = createFileRoute('/')({
  loader: async () => ({
    products: await listProducts({ data: {} }),
  }),
  component: Home,
})

function Home() {
  const { products } = Route.useLoaderData()
  const featured = products.slice(0, 8)

  return (
    <Page>
      <section className="hero">
        <HeroAscii />

        <div className="wrap">
          <div className="hero__copy">
            {/*
              The shop is the brand here, not the labels it stocks. The eyebrow
              and lede stay to what the shop can actually stand behind — where
              it is and where it delivers — rather than a supplier's founding
              year or a claim about distribution rights.
            */}
            <p className="hero__eyebrow">Улаанбаатар</p>
            <h1>
              Three33
              <span className="hero__accent">Barber</span>
            </h1>
            <p className="hero__lede">
              Мэргэжлийн үс засал, сахал арчилгааны бүтээгдэхүүн. Улаанбаатар
              хот болон орон нутагт хүргэнэ.
            </p>
            <div className="hero__actions">
              <Link to="/products" className="btn">
                Бүтээгдэхүүн үзэх
              </Link>
              {/* <Link
                to="/products"
                search={{ category: 'styling' }}
                className="btn btn--onDark"
              >
                Үс засалт
              </Link> */}
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
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
