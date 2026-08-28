import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { orderItems, orders, payments } from '~/db/schema'
import { authorize } from './internal'
import { settleOrder } from './settle'

export const orderNoInput = z.object({
  orderNo: z.string().trim().min(1).max(45),
  /**
   * Optional because the usual proof is the checkout cookie. Supplied when a
   * payment link is opened somewhere the cookie never reached — another device,
   * or a browser that dropped it.
   */
  token: z.string().trim().max(200).optional(),
})

/**
 * Polled by the payment page.
 *
 * While the order is pending it actively asks QPay rather than just reading our
 * own row. That means the customer's page settles even if the callback never
 * arrives — the same reason the reconciliation sweep exists, applied to the one
 * customer who is sitting there watching. settleOrder throttles how often that
 * question actually reaches QPay.
 */
export const getOrderStatus = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }) => {
    const order = await authorize(data.orderNo, data.token)
    if (!order) return { status: 'not_found' as const }

    if (order.status === 'pending_payment') {
      await settleOrder(data.orderNo)

      const [refreshed] = await db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id))
        .limit(1)

      return {
        status: refreshed?.status ?? order.status,
        total: order.total,
        expiresAt: order.expiresAt.getTime(),
      }
    }

    return {
      status: order.status,
      total: order.total,
      expiresAt: order.expiresAt.getTime(),
    }
  })

export const getOrder = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }) => {
    const authorized = await authorize(data.orderNo, data.token)
    if (!authorized) return null

    const [order] = await db
      .select({
        orderNo: orders.orderNo,
        status: orders.status,
        subtotal: orders.subtotal,
        shippingFee: orders.shippingFee,
        total: orders.total,
        contactPhone: orders.contactPhone,
        note: orders.note,
        address: orders.shippingAddressSnapshot,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.id, authorized.id))
      .limit(1)

    if (!order) return null

    const items = await db
      .select({
        name: orderItems.nameSnapshot,
        sku: orderItems.skuSnapshot,
        unitPrice: orderItems.unitPrice,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, authorized.id))
      .orderBy(asc(orderItems.id))

    return { ...order, items }
  })

/** Invoice details for the payment page, re-read on reload. */
export const getPaymentDetails = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }) => {
    const order = await authorize(data.orderNo, data.token)
    if (!order) return null

    const [row] = await db
      .select({
        invoiceId: payments.qpayInvoiceId,
        amount: payments.amount,
      })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .limit(1)

    if (!row) return null

    return {
      ...row,
      status: order.status,
      expiresAt: order.expiresAt.getTime(),
    }
  })
