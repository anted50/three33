import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { orderItems, orders, payments } from '~/db/schema'
import { settleOrder } from './settle'

export const orderNoInput = z.object({
  orderNo: z.string().trim().min(1).max(45),
})

/**
 * Polled by the payment page every few seconds.
 *
 * While the order is pending it actively asks QPay rather than just reading our
 * own row. That means the customer's page settles even if the callback never
 * arrives — the same reason the reconciliation sweep exists, applied to the one
 * customer who is sitting there watching.
 */
export const getOrderStatus = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }) => {
    const [order] = await db
      .select({ status: orders.status, total: orders.total })
      .from(orders)
      .where(eq(orders.orderNo, data.orderNo))
      .limit(1)

    if (!order) return { status: 'not_found' as const }

    if (order.status === 'pending_payment') {
      await settleOrder(data.orderNo)

      const [refreshed] = await db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.orderNo, data.orderNo))
        .limit(1)

      return { status: refreshed?.status ?? order.status, total: order.total }
    }

    return { status: order.status, total: order.total }
  })

export const getOrder = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }) => {
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
      .where(eq(orders.orderNo, data.orderNo))
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
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orders.orderNo, data.orderNo))
      .orderBy(asc(orderItems.id))

    return { ...order, items }
  })

/** Invoice details for the payment page, re-read on reload. */
export const getPaymentDetails = createServerFn({ method: 'GET' })
  .validator(orderNoInput)
  .handler(async ({ data }) => {
    const [row] = await db
      .select({
        invoiceId: payments.qpayInvoiceId,
        amount: payments.amount,
        status: orders.status,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(orders.orderNo, data.orderNo))
      .limit(1)

    return row ?? null
  })
