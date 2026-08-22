import { asc, eq } from 'drizzle-orm'
import { db } from '~/db'
import { orderItems, orders, payments } from '~/db/schema'
import { formatMnt, type Mungu } from '~/lib/money'
import { sendEmail } from '../email/zeptomail'
import { env } from '../env'
import { getQpayProvider } from '../payments/qpay'
import type { EbarimtReceipt } from '../payments/qpay'

interface ReceiptItem {
  name: string
  sku: string
  unitPrice: Mungu
  qty: number
}

interface ReceiptOrder {
  orderNo: string
  name: string
  subtotal: Mungu
  shippingFee: Mungu
  total: Mungu
  createdAt: Date
}

/**
 * Emails the customer their receipt once an order settles.
 *
 * Fire-and-forget from settleOrder: by the time this runs, the payment is
 * already committed, so nothing in here is allowed to throw back into that
 * path — every failure is caught and logged instead. A receipt that never
 * arrives is a support ticket; a settlement that rolls back over a flaky mail
 * API is a much worse one.
 */
export async function sendOrderReceipt(orderNo: string): Promise<void> {
  try {
    const [order] = await db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        subtotal: orders.subtotal,
        shippingFee: orders.shippingFee,
        total: orders.total,
        createdAt: orders.createdAt,
        address: orders.shippingAddressSnapshot,
      })
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1)

    // No email on file (older orders, or the field was left blank) — nothing
    // to send to, and not an error.
    if (!order || !order.address.email) return

    const items = await db
      .select({
        name: orderItems.nameSnapshot,
        sku: orderItems.skuSnapshot,
        unitPrice: orderItems.unitPrice,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.id))

    const [payment] = await db
      .select({ qpayPaymentId: payments.qpayPaymentId })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .limit(1)

    const ebarimt = payment?.qpayPaymentId
      ? await getQpayProvider().createEbarimt(
          payment.qpayPaymentId,
          env.QPAY_EBARIMT_INVOICE_CODE,
        )
      : null

    const { html, text } = renderReceipt(
      { ...order, name: order.address.name },
      items,
      ebarimt,
    )

    await sendEmail({
      to: { email: order.address.email, name: order.address.name },
      subject: `Захиалгын баримт — ${order.orderNo}`,
      html,
      text,
    })
  } catch (error) {
    console.error(`Failed to send receipt for order ${orderNo}:`, error)
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}, ` +
    `${p(date.getHours())}:${p(date.getMinutes())}`
  )
}

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** 520px: wide enough to read comfortably, narrow enough to still look like a
 * single receipt and not a full-width marketing layout. */
const MAX_WIDTH = 520

function itemRow(item: ReceiptItem): string {
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #ececea;font-size:14px;color:#0a0a0a">${escapeHtml(item.name)}</td>
      <td style="padding:14px 0;border-bottom:1px solid #ececea;font-size:13px;color:#8a8a86;text-align:center;white-space:nowrap">×${item.qty}</td>
      <td style="padding:14px 0;border-bottom:1px solid #ececea;font-size:14px;color:#0a0a0a;text-align:right;white-space:nowrap">${formatMnt(item.unitPrice * item.qty)}</td>
    </tr>`
}

/**
 * The e-barimt section, or nothing at all when there's no e-barimt to show —
 * QPAY_EBARIMT_INVOICE_CODE isn't configured yet, so this simply doesn't
 * render rather than showing a placeholder for a feature that isn't live.
 */
function ebarimtSection(ebarimt: EbarimtReceipt | null): string {
  if (!ebarimt?.qrImage) return ''

  const link = ebarimt.qrData?.startsWith('http')
    ? `<p style="margin:10px 0 0;font-size:12px"><a href="${escapeHtml(ebarimt.qrData)}" style="color:#0a0a0a;text-decoration:underline">Онлайнаар харах ↗</a></p>`
    : ''

  return `
    <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:0 24px 36px;text-align:center;border-top:1px solid #ececea;padding-top:32px">
      <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5c5c58">И-баримт</p>
      <img src="data:image/png;base64,${ebarimt.qrImage}" width="160" height="160" alt="И-баримтын QR код" style="display:block;margin:0 auto;width:160px;height:160px;border:1px solid #0a0a0a" />
      ${ebarimt.id ? `<p style="margin:12px 0 0;font-size:12px;color:#5c5c58">Дугаар: ${escapeHtml(ebarimt.id)}</p>` : ''}
      ${ebarimt.lottery ? `<p style="margin:2px 0 0;font-size:12px;color:#5c5c58">Сугалаа: ${escapeHtml(ebarimt.lottery)}</p>` : ''}
      ${link}
    </div>
  `
}

/**
 * A clean, monochrome transactional receipt: sans-serif, a grey confirmation
 * block up top carrying the headline and order meta, then a plain itemised
 * table, then the e-barimt QR. No photography, no colour beyond black/white/
 * grey — the shop's own accent stays off this one, the same way a paper
 * receipt from any till is black ink on white stock.
 */
function renderReceipt(
  order: ReceiptOrder,
  items: ReceiptItem[],
  ebarimt: EbarimtReceipt | null,
): { html: string; text: string } {
  const shippingLine =
    order.shippingFee === 0 ? 'Үнэгүй' : formatMnt(order.shippingFee)
  const statusUrl = `${env.APP_URL}/orders/${order.orderNo}/success`

  const text = [
    `Сайн байна уу, ${order.name},`,
    '',
    'Захиалга баталгаажлаа!',
    '',
    `Захиалгын дугаар: ${order.orderNo}`,
    `Огноо: ${formatDate(order.createdAt)}`,
    `Захиалгаа харах: ${statusUrl}`,
    '',
    'Таны бараа:',
    ...items.map((i) => `  ${i.name} ×${i.qty} — ${formatMnt(i.unitPrice * i.qty)}`),
    '',
    `Дүн: ${formatMnt(order.subtotal)}`,
    `Хүргэлт: ${shippingLine}`,
    `Нийт: ${formatMnt(order.total)}`,
    ...(ebarimt?.id ? ['', `И-баримт дугаар: ${ebarimt.id}`] : []),
    ...(ebarimt?.lottery ? [`Сугалаа: ${ebarimt.lottery}`] : []),
    ...(ebarimt?.qrData ? [`И-баримт: ${ebarimt.qrData}`] : []),
    '',
    'Танд баярлалаа — Three 33 Barbershop',
  ].join('\n')

  const html = `
    <div style="background:#ffffff;font-family:${SANS};color:#0a0a0a">
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:36px 24px 0;text-align:center">
        <img src="${env.APP_URL}/email-logo.png" alt="Three 33 Barbershop" width="200" height="28" style="display:inline-block;width:200px;height:28px" />
      </div>

      <div style="max-width:${MAX_WIDTH}px;margin:28px auto 0;background:#f4f4f2;padding:32px 24px">
        <p style="margin:0 0 6px;font-size:14px">Сайн байна уу, ${escapeHtml(order.name)},</p>
        <h1 style="margin:0 0 22px;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.01em">Захиалга<br/>баталгаажлаа!</h1>
        <p style="margin:0 0 3px;font-size:13px;color:#5c5c58">Захиалгын дугаар: ${escapeHtml(order.orderNo)}</p>
        <p style="margin:0 0 20px;font-size:13px;color:#5c5c58">Огноо: ${formatDate(order.createdAt)}</p>
        <a href="${statusUrl}" style="font-size:14px;font-weight:700;color:#0a0a0a;text-decoration:underline">Захиалгаа харах →</a>
      </div>

      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:28px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <td colspan="2" style="padding-bottom:10px;border-bottom:1px solid #0a0a0a;font-size:13px;color:#5c5c58">Таны бараа</td>
            <td style="padding-bottom:10px;border-bottom:1px solid #0a0a0a;font-size:14px;font-weight:800;text-align:right;white-space:nowrap">Нийт: ${formatMnt(order.total)}</td>
          </tr>
          ${items.map(itemRow).join('')}
        </table>
      </div>

      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:14px 24px 32px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#5c5c58">
          <tr><td style="padding:3px 0">Дүн</td><td style="padding:3px 0;text-align:right">${formatMnt(order.subtotal)}</td></tr>
          <tr><td style="padding:3px 0">Хүргэлт</td><td style="padding:3px 0;text-align:right">${shippingLine}</td></tr>
        </table>
      </div>

      ${ebarimtSection(ebarimt)}

      <div style="border-top:1px solid #ececea;padding:24px;text-align:center">
        <p style="margin:0;font-size:12px;color:#8a8a86">Танд баярлалаа — Three 33 Barbershop</p>
      </div>
    </div>
  `

  return { html, text }
}
