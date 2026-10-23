import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '~/db'
import { changed, type Statement } from '~/db/atomic'
import { barberSaleLines, inventoryLedger, productVariants } from '~/db/schema'
import { conflict } from '../../api/errors'
import type { Executor } from '../db'

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

/** A product line whose stock has not been taken yet. */
export interface StockLine {
  id: string
  variantId: string
  qty: number
  sku: string | null
}

/** The sale's product lines still waiting for their stock. */
export async function undeductedLines(saleId: string): Promise<StockLine[]> {
  const rows = await db
    .select({ id: barberSaleLines.id, variantId: barberSaleLines.variantId, qty: barberSaleLines.qty, sku: barberSaleLines.skuSnapshot })
    .from(barberSaleLines)
    .where(and(eq(barberSaleLines.saleId, saleId), isNotNull(barberSaleLines.variantId), isNull(barberSaleLines.inventoryLedgerId)))
  return rows.map((r) => ({ ...r, variantId: r.variantId! }))
}

/**
 * Statements deducting stock for `lines`, for the batch that closes the sale.
 *
 *   strict   the money isn't taken yet (cash / pos / transfer entry): a
 *            shortfall aborts the batch with OUT_OF_STOCK, so the payment is
 *            not recorded either
 *   lenient  QPay already took the money: like online settlement, record a
 *            zero-delta 'manual_adjustment' for the owner to resolve rather
 *            than refuse a payment the customer has made
 *
 * Each line gets its ledger row's id up front, so the same batch can point
 * the sale line at it.
 */
export function deductStock(lines: StockLine[], actorId: string | null, strict: boolean): Statement[] {
  return lines.flatMap((line) => {
    const movementId = crypto.randomUUID()
    // The guard in WHERE makes a race that would oversell update nothing.
    const take = db
      .update(productVariants)
      .set({ stockQty: sql`${productVariants.stockQty} - ${line.qty}` })
      .where(and(eq(productVariants.id, line.variantId), sql`${productVariants.stockQty} >= ${line.qty}`))

    const record = strict
      ? [
          changed('OUT_OF_STOCK'),
          db.insert(inventoryLedger).values({ id: movementId, variantId: line.variantId, delta: -line.qty, reason: 'pos_sale', actorId }),
        ]
      : [
          // changes() is still the decrement's: nothing ran in between.
          db.insert(inventoryLedger).select(sql`
            select
              ${movementId},
              ${line.variantId},
              case when changes() > 0 then ${-line.qty} else 0 end,
              case when changes() > 0 then 'pos_sale' else 'manual_adjustment' end,
              null,
              ${actorId},
              ${Date.now()}
          `),
        ]

    return [
      take,
      ...record,
      db.update(barberSaleLines).set({ inventoryLedgerId: movementId }).where(eq(barberSaleLines.id, line.id)),
    ]
  })
}
