import { randomBytes } from 'node:crypto'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import { carts, productImages, productVariants, products } from '~/db/schema'
import { sumMungu, type Mungu } from '~/lib/money'
import { CART_COOKIE, CART_MAX_AGE, cartCookieOptions } from '../cookies'
import { clampQty } from './pricing'
import { cartItems } from '~/db/schema'

/**
 * Server-only cart internals.
 *
 * This file exists to keep a bundling boundary honest. A module that exports
 * anything other than server functions gets retained in the client graph, and
 * with it every import it touches — which for the cart meant `env` (holding the
 * QPay password) and the QPay client (which needs Node's Buffer).
 *
 * The symptom was "Buffer is not defined" in the browser and a dead Add to
 * cart button. The real problem was secrets being handed to the client bundler
 * at all. Nothing here may be imported from a route.
 */

export interface CartLine {
  variantId: string
  productSlug: string
  productName: string
  size: string | null
  sku: string
  /** Live price from product_variants, not the stored snapshot. */
  unitPrice: Mungu
  lineTotal: Mungu
  qty: number
  stockQty: number
  imageUrl: string | null
}

export interface CartView {
  lines: CartLine[]
  subtotal: Mungu
  itemCount: number
}

/**
 * Reads the cart cookie, minting one if absent. Always re-sets it so an active
 * shopper's cart does not expire mid-browse.
 */
export function readOrIssueToken(): string {
  const token = getCookie(CART_COOKIE) ?? randomBytes(24).toString('base64url')
  setCookie(CART_COOKIE, token, { ...cartCookieOptions, maxAge: CART_MAX_AGE })
  return token
}

export async function loadOrCreateCart(token: string): Promise<string> {
  const [existing] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.sessionToken, token))
    .limit(1)

  if (existing) return existing.id

  const [created] = await db
    .insert(carts)
    .values({
      sessionToken: token,
      expiresAt: new Date(Date.now() + CART_MAX_AGE * 1000),
    })
    .onConflictDoNothing({ target: carts.sessionToken })
    .returning({ id: carts.id })

  if (created) return created.id

  // Lost an insert race with a concurrent request on the same cookie.
  const [raced] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.sessionToken, token))
    .limit(1)

  if (!raced) throw new Error('Could not create a cart')
  return raced.id
}

/**
 * Loads the cart and re-prices every line from product_variants.
 *
 * cart_items.unit_price_snapshot is deliberately ignored. It exists so an admin
 * can see what a customer was shown; it is never what they are charged. If a
 * price changed while the cart sat there, the customer sees the new one before
 * they pay, not after.
 */
export async function readCart(cartId: string): Promise<CartView> {
  const rows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      unitPrice: productVariants.price,
      stockQty: productVariants.stockQty,
      isActive: productVariants.isActive,
      qty: cartItems.qty,
      productSlug: products.slug,
      productName: products.nameMn,
      // Correlated subquery — a Drizzle query builder cannot nest in a select.
      imageUrl: sql<string | null>`(
        select ${productImages.url}
        from ${productImages}
        where ${productImages.productId} = ${products.id}
        order by ${productImages.sortOrder}
        limit 1
      )`,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.id))

  const lines: CartLine[] = []

  for (const row of rows) {
    // A variant deactivated or sold out since it was added is dropped from the
    // view rather than silently priced into the total.
    if (!row.isActive) continue

    const qty = clampQty(row.qty, row.stockQty)
    if (qty === 0) continue

    lines.push({
      variantId: row.variantId,
      productSlug: row.productSlug,
      productName: row.productName,
      size: row.size,
      sku: row.sku,
      unitPrice: row.unitPrice,
      lineTotal: row.unitPrice * qty,
      qty,
      stockQty: row.stockQty,
      imageUrl: row.imageUrl ?? null,
    })
  }

  return {
    lines,
    subtotal: sumMungu(lines.map((l) => l.lineTotal)),
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
  }
}

export async function currentCart(): Promise<{
  cartId: string
  cart: CartView
}> {
  const cartId = await loadOrCreateCart(readOrIssueToken())
  return { cartId, cart: await readCart(cartId) }
}
