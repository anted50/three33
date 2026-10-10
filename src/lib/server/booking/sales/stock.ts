import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { barberSaleLines, inventoryLedger, productVariants } from '~/db/schema'
import { conflict } from '../../api/errors'
import type { Executor, Tx } from '../db'

/**
 * Stock for POS product lines, by the shop's own rules: never reserved while
 * a sale is open, deducted exactly once when the sale is paid, and every
 * movement written to inventory_ledger (reason 'pos_sale').
 *
 * Product lines are the ones with a sku snapshot — that survives the owner
 * later removing the variant, which only nulls variant_id.
 */

/** Refuses before money is taken if the shelf can't cover the product lines. */
export async function assertStock(ex: Executor, saleId: string) {
  const lines = await ex
    .select({ variantId: barberSaleLines.variantId, qty: barberSaleLines.qty, sku: barberSaleLines.skuSnapshot })
    .from(barberSaleLines)
    .where(and(eq(barberSaleLines.saleId, saleId), isNotNull(barberSaleLines.variantId), isNull(barberSaleLines.inventoryLedgerId)))
  await assertAvailable(ex, lines)
}

export async function assertAvailable(
  ex: Executor,
  lines: Array<{ variantId: string | null; qty: number; sku: string | null }>,
) {
  const wanted = new Map<string, { qty: number; sku: string | null }>()
  for (const l of lines) {
    if (!l.variantId) continue
    const prev = wanted.get(l.variantId)
    wanted.set(l.variantId, { qty: (prev?.qty ?? 0) + l.qty, sku: l.sku })
  }
  if (wanted.size === 0) return

  const stock = await ex
    .select({ id: productVariants.id, stockQty: productVariants.stockQty })
    .from(productVariants)
    .where(inArray(productVariants.id, [...wanted.keys()]))
  for (const [variantId, need] of wanted) {
    const have = stock.find((s) => s.id === variantId)?.stockQty ?? 0
    if (have < need.qty) {
      throw conflict('OUT_OF_STOCK', `${need.sku ?? 'A product'} has ${have} in stock`, { sku: need.sku, inStock: have })
    }
  }
}

/**
 * Deducts stock for every product line not yet deducted, inside the
 * transaction that closes the sale.
 *
 *   strict   the money isn't taken yet (cash / pos / transfer entry): a
 *            shortfall throws OUT_OF_STOCK and the whole payment rolls back
 *   lenient  QPay already took the money: like online settlement, record a
 *            zero-delta 'manual_adjustment' for the owner to resolve rather
 *            than refuse a payment the customer has made
 */
export async function deductStock(tx: Tx, saleId: string, actorId: string | null, strict: boolean) {
  const lines = await tx
    .select({ id: barberSaleLines.id, variantId: barberSaleLines.variantId, qty: barberSaleLines.qty, sku: barberSaleLines.skuSnapshot })
    .from(barberSaleLines)
    .where(and(eq(barberSaleLines.saleId, saleId), isNotNull(barberSaleLines.variantId), isNull(barberSaleLines.inventoryLedgerId)))

  for (const line of lines) {
    const variantId = line.variantId!
    // The guard in WHERE makes a race that would oversell update nothing.
    const taken = await tx
      .update(productVariants)
      .set({ stockQty: sql`${productVariants.stockQty} - ${line.qty}` })
      .where(and(eq(productVariants.id, variantId), sql`${productVariants.stockQty} >= ${line.qty}`))
      .returning({ id: productVariants.id })

    if (taken.length === 0 && strict) {
      throw conflict('OUT_OF_STOCK', `${line.sku ?? 'A product'} is out of stock`, { sku: line.sku })
    }

    const [movement] = await tx
      .insert(inventoryLedger)
      .values(
        taken.length > 0
          ? { variantId, delta: -line.qty, reason: 'pos_sale', actorId }
          : { variantId, delta: 0, reason: 'manual_adjustment', actorId },
      )
      .returning({ id: inventoryLedger.id })
    await tx.update(barberSaleLines).set({ inventoryLedgerId: movement!.id }).where(eq(barberSaleLines.id, line.id))
  }
}
