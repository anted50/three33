import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { orders, type OrderStatus } from '~/db/schema'
import { readCheckoutToken, verifyOrderToken } from './access'

/**
 * Server-only order internals.
 *
 * Same bundling boundary as cart/internal.ts, for the same reason. A module
 * that exports anything other than server functions stays in the client graph,
 * and with it everything it imports — here that would be node:crypto and, via
 * `~/db`, the whole postgres driver. The build fails outright when that
 * happens ("performance is not exported by __vite-browser-external"), which is
 * the polite version of shipping the database client to the browser.
 *
 * So the shared guard lives here, and the modules routes import export only
 * server functions and schemas. Nothing here may be imported from a route.
 */

export interface AuthorizedOrder {
  id: string
  orderNo: string
  status: OrderStatus
  total: number
  expiresAt: Date
}

/**
 * Every customer-facing read of an order goes through here.
 *
 * Returns null for an order that does not exist AND for one the caller cannot
 * prove they own — the two are deliberately indistinguishable. Answering
 * "wrong token" would confirm that an order number is real, which is precisely
 * what someone enumerating UD-YYMMDD-XXXX is trying to learn.
 */
export async function authorize(
  orderNo: string,
  explicitToken?: string,
): Promise<AuthorizedOrder | null> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      total: orders.total,
      expiresAt: orders.expiresAt,
      accessTokenHash: orders.accessTokenHash,
    })
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .limit(1)

  if (!order) return null

  const token = readCheckoutToken(orderNo, explicitToken)
  if (!verifyOrderToken(token, order.accessTokenHash)) return null

  const { accessTokenHash: _hash, ...rest } = order
  return rest
}
