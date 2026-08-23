import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { cartItems, productVariants } from '~/db/schema'
import { clampQty } from './pricing'
import { currentCart, readCart, type CartView } from './internal'

/**
 * The cart's public surface. Routes import from HERE and nowhere deeper.
 *
 * This module must export only server functions and types. Anything else keeps
 * the module — and every import it reaches, including `env` and the QPay
 * client — alive in the client bundle. See ./internal.ts.
 */

export type { CartLine, CartView } from './internal'

export const getCart = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CartView> => {
    const { cart } = await currentCart()
    return cart
  },
)

/**
 * The shipping rates the server will actually apply.
 *
 * Checkout used to hardcode these in the component to show an estimate, which
 * silently diverged the moment the stored values changed — the page said 5,000₮
 * while the invoice would have been 0₮. A quoted price that disagrees with the
 * charge is worse than no quote, so the estimate now comes from the same
 * numbers the charge does.
 */
export const getShippingRates = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { loadShippingRates } = await import('../settings')
    return loadShippingRates()
  },
)

export const addToCartInput = z.object({
  variantId: z.uuid(),
  qty: z.number().int().min(1).max(99),
})

export const addToCart = createServerFn({ method: 'POST' })
  .validator(addToCartInput)
  .handler(async ({ data }): Promise<CartView> => {
    const { cartId } = await currentCart()

    const [variant] = await db
      .select({
        id: productVariants.id,
        stockQty: productVariants.stockQty,
        price: productVariants.price,
        isActive: productVariants.isActive,
      })
      .from(productVariants)
      .where(eq(productVariants.id, data.variantId))
      .limit(1)

    if (!variant || !variant.isActive) {
      throw new Error('Энэ бүтээгдэхүүн одоогоор борлуулалтад алга')
    }

    const [existing] = await db
      .select({ id: cartItems.id, qty: cartItems.qty })
      .from(cartItems)
      .where(
        and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variant.id)),
      )
      .limit(1)

    // Adding to an existing line tops it up rather than replacing it.
    const qty = clampQty((existing?.qty ?? 0) + data.qty, variant.stockQty)
    if (qty === 0) throw new Error('Нөөц хүрэлцэхгүй байна')

    if (existing) {
      await db
        .update(cartItems)
        .set({ qty, unitPriceSnapshot: variant.price })
        .where(eq(cartItems.id, existing.id))
    } else {
      await db.insert(cartItems).values({
        cartId,
        variantId: variant.id,
        qty,
        unitPriceSnapshot: variant.price,
      })
    }

    return readCart(cartId)
  })

export const setCartQtyInput = z.object({
  variantId: z.uuid(),
  /** 0 removes the line. */
  qty: z.number().int().min(0).max(99),
})

export const setCartQty = createServerFn({ method: 'POST' })
  .validator(setCartQtyInput)
  .handler(async ({ data }): Promise<CartView> => {
    const { cartId } = await currentCart()

    const remove = () =>
      db
        .delete(cartItems)
        .where(
          and(
            eq(cartItems.cartId, cartId),
            eq(cartItems.variantId, data.variantId),
          ),
        )

    if (data.qty === 0) {
      await remove()
      return readCart(cartId)
    }

    const [variant] = await db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, data.variantId))
      .limit(1)

    const qty = clampQty(data.qty, variant?.stockQty ?? 0)

    if (qty === 0) {
      await remove()
    } else {
      await db
        .update(cartItems)
        .set({ qty })
        .where(
          and(
            eq(cartItems.cartId, cartId),
            eq(cartItems.variantId, data.variantId),
          ),
        )
    }

    return readCart(cartId)
  })
