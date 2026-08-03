import { createFileRoute, Link } from '@tanstack/react-router'
import { Page } from '~/components/layout'

/**
 * Placeholder. The cart is Phase 3 — guest cart keyed by a cookie token,
 * merged into the user's cart on login, with totals recomputed server-side on
 * every load rather than trusted from the client.
 *
 * It exists now so the header's cart link is a real, type-checked route.
 */
export const Route = createFileRoute('/cart')({
  component: Cart,
})

function Cart() {
  return (
    <Page>
      <div className="wrap">
        <p className="empty">
          Таны сагс хоосон байна.
          <br />
          <br />
          <Link to="/products" className="btn" style={{ maxWidth: 260 }}>
            Бүтээгдэхүүн үзэх
          </Link>
        </p>
      </div>
    </Page>
  )
}
