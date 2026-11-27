import { createFileRoute, Link } from '@tanstack/react-router'
import { HeroPhoto } from '~/components/hero-photo'
import { Page, ProductsIcon } from '~/components/layout'
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
      {/* hero--photo switches the band to the dark treatment the photograph sits under. */}
      <section className="hero hero--photo">
        <HeroPhoto />

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
            {/*
              Set as three lines rather than one wrapping paragraph: they are
              three separate claims, and at this measure the browser broke them
              mid-claim, which read as a sentence that had run long rather than
              as a tagline. The longest is 24 characters, so the explicit breaks
              still fit a 375px phone without wrapping again.
            */}
            <p className="hero__lede">
              Authentic products.
              <br />
              Modern grooming.
              <br />
              Timeless barber culture.
            </p>
            <div className="hero__actions">
              <Link to="/products" className="btn">
                <ProductsIcon />
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
