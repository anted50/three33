/**
 * Bounds on order data. No imports, so pure modules and scripts can use them
 * without loading the database client or the request helpers.
 */

/**
 * Most lines one order may hold, and so the bound on every read of
 * order_items. Checkout orders hold at most MAX_CART_LINES (50); an admin
 * invoice holds up to 100 (admin/invoice-lines.ts). Reads ask for one more
 * than this, so an order that somehow exceeds it fails loudly instead of being
 * settled, receipted or shown in part.
 */
export const ORDER_LINES_MAX = 100
