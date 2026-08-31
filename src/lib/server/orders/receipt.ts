import { asc, eq } from 'drizzle-orm'
import { db } from '~/db'
import { orderItems, orders, payments } from '~/db/schema'
import { formatMnt, type Mungu } from '~/lib/money'
import { logoAttachment, logoImgTag } from '../email/logo'
import {
  emailDocument,
  INK,
  INK_FAINT,
  INK_SOFT,
  PANEL,
  PAPER,
  RULE,
} from '../email/shell'
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
  /** Null on every order placed since checkout stopped asking for a name. */
  name: string | null
  subtotal: Mungu
  shippingFee: Mungu
  total: Mungu
  createdAt: Date
}

/**
 * What asking for a receipt did. Only `sent` put mail on the wire; the others
 * are ordinary answers, not failures — a genuine failure throws.
 */
export type ReceiptOutcome =
  /** Handed to ZeptoMail, which accepted it. */
  | 'sent'
  /** No address on file: older orders, or the field was left blank. */
  | 'no_email'
  | 'not_found'
  /** MAIL_API_TOKEN is unset, so sending is skipped — see email/zeptomail.ts. */
  | 'mail_disabled'

/**
 * Builds and sends the customer's receipt, reporting what happened.
 *
 * Throws on a real failure, so a caller with a human waiting on the answer —
 * the admin panel's send button — can show it. The settlement path uses
 * sendOrderReceipt below instead, which deliberately swallows everything.
 */
export async function deliverOrderReceipt(
  orderNo: string,
): Promise<ReceiptOutcome> {
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

  if (!order) return 'not_found'
  // No address on file — nothing to send to, and not an error.
  if (!order.address.email) return 'no_email'

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

  const logo = logoAttachment()

  const sent = await sendEmail({
    to: { email: order.address.email, name: order.address.name ?? undefined },
    subject: `Захиалгын баримт — ${order.orderNo}`,
    html,
    text,
    inlineImages: logo ? [logo] : undefined,
  })

  return sent ? 'sent' : 'mail_disabled'
}

/**
 * Fire-and-forget from settleOrder: by the time this runs, the payment is
 * already committed, so nothing in here is allowed to throw back into that
 * path — every failure is caught and logged instead. A receipt that never
 * arrives is a support ticket; a settlement that rolls back over a flaky mail
 * API is a much worse one.
 *
 * Which is also why the admin panel has a button that calls
 * deliverOrderReceipt directly: this log line is otherwise the only trace that
 * a receipt was owed and never went out.
 */
export async function sendOrderReceipt(orderNo: string): Promise<void> {
  try {
    await deliverOrderReceipt(orderNo)
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

/**
 * The `keepink`/`soft`/`faint` classes on everything that carries a colour are
 * the hooks the shell's dark-mode overrides target — see email/shell.ts. A
 * style attribute alone is not enough, because the clients this guards against
 * rewrite style attributes; only an !important rule from a <style> block wins
 * against them.
 */
function itemRow(item: ReceiptItem): string {
  return `
    <tr>
      <td class="keepink" style="padding:14px 0;border-bottom:1px solid ${RULE};font-size:14px;color:${INK}">${escapeHtml(item.name)}</td>
      <td class="faint" style="padding:14px 0;border-bottom:1px solid ${RULE};font-size:13px;color:${INK_FAINT};text-align:center;white-space:nowrap">×${item.qty}</td>
      <td class="keepink" style="padding:14px 0;border-bottom:1px solid ${RULE};font-size:14px;color:${INK};text-align:right;white-space:nowrap">${formatMnt(item.unitPrice * item.qty)}</td>
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
    ? `<p class="keepink" style="margin:10px 0 0;font-size:12px;color:${INK}"><a href="${escapeHtml(ebarimt.qrData)}" style="color:${INK};text-decoration:underline">Онлайнаар харах ↗</a></p>`
    : ''

  return `
    <div class="lightbg" bgcolor="${PAPER}" style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:0 24px 36px;text-align:center;border-top:1px solid ${RULE};padding-top:32px;background-color:${PAPER}">
      <p class="soft" style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${INK_SOFT}">И-баримт</p>
      <!-- The QR is white-background/black-module by construction, so a client
           that recolours around it would leave it floating on dark; the white
           padding box keeps it on its own paper either way. -->
      <img src="data:image/png;base64,${ebarimt.qrImage}" width="160" height="160" alt="И-баримтын QR код" style="display:block;margin:0 auto;width:160px;height:160px;border:8px solid ${PAPER};outline:1px solid ${INK};background-color:${PAPER}" />
      ${ebarimt.id ? `<p class="soft" style="margin:12px 0 0;font-size:12px;color:${INK_SOFT}">Дугаар: ${escapeHtml(ebarimt.id)}</p>` : ''}
      ${ebarimt.lottery ? `<p class="soft" style="margin:2px 0 0;font-size:12px;color:${INK_SOFT}">Сугалаа: ${escapeHtml(ebarimt.lottery)}</p>` : ''}
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
export function renderReceipt(
  order: ReceiptOrder,
  items: ReceiptItem[],
  ebarimt: EbarimtReceipt | null,
): { html: string; text: string } {
  const shippingLine =
    order.shippingFee === 0 ? 'Үнэгүй' : formatMnt(order.shippingFee)
  /**
   * Nameless orders are the normal case now — the checkout form only asks for
   * a phone number — so the greeting drops the name rather than addressing
   * anyone as "null".
   */
  const greeting = order.name
    ? `Сайн байна уу, ${order.name},`
    : 'Сайн байна уу,'
  const greetingHtml = order.name
    ? `Сайн байна уу, ${escapeHtml(order.name)},`
    : 'Сайн байна уу,'
  const statusUrl = `${env.APP_URL}/orders/${order.orderNo}/success`

  const text = [
    greeting,
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
    'Танд баярлалаа — Three33 Barbershop',
  ].join('\n')

  const body = `
    <div class="lightbg" bgcolor="${PAPER}" style="background-color:${PAPER};font-family:${SANS};color:${INK};width:100%">
      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:36px 24px 0;text-align:center">
        ${logoImgTag()}
      </div>

      <div class="panel" bgcolor="${PANEL}" style="max-width:${MAX_WIDTH}px;margin:28px auto 0;background-color:${PANEL};padding:32px 24px">
        <p class="keepink" style="margin:0 0 6px;font-size:14px;color:${INK}">${greetingHtml}</p>
        <h1 class="keepink" style="margin:0 0 22px;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.01em;color:${INK}">Захиалга<br/>баталгаажлаа!</h1>
        <p class="soft" style="margin:0 0 3px;font-size:13px;color:${INK_SOFT}">Захиалгын дугаар: ${escapeHtml(order.orderNo)}</p>
        <p class="soft" style="margin:0 0 20px;font-size:13px;color:${INK_SOFT}">Огноо: ${formatDate(order.createdAt)}</p>
        <a class="keepink" href="${statusUrl}" style="font-size:14px;font-weight:700;color:${INK};text-decoration:underline">Захиалгаа харах →</a>
      </div>

      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:28px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr>
            <td colspan="2" class="soft" style="padding-bottom:10px;border-bottom:1px solid ${INK};font-size:13px;color:${INK_SOFT}">Таны бараа</td>
            <td class="keepink" style="padding-bottom:10px;border-bottom:1px solid ${INK};font-size:14px;font-weight:800;text-align:right;white-space:nowrap;color:${INK}">Нийт: ${formatMnt(order.total)}</td>
          </tr>
          ${items.map(itemRow).join('')}
        </table>
      </div>

      <div style="max-width:${MAX_WIDTH}px;margin:0 auto;padding:14px 24px 32px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="soft" style="border-collapse:collapse;font-size:13px;color:${INK_SOFT}">
          <tr><td class="soft" style="padding:3px 0;color:${INK_SOFT}">Дүн</td><td class="soft" style="padding:3px 0;text-align:right;color:${INK_SOFT}">${formatMnt(order.subtotal)}</td></tr>
          <tr><td class="soft" style="padding:3px 0;color:${INK_SOFT}">Хүргэлт</td><td class="soft" style="padding:3px 0;text-align:right;color:${INK_SOFT}">${shippingLine}</td></tr>
        </table>
      </div>

      ${ebarimtSection(ebarimt)}

      <div style="border-top:1px solid ${RULE};padding:24px;text-align:center">
        <p class="faint" style="margin:0;font-size:12px;color:${INK_FAINT}">Танд баярлалаа — Three33 Barbershop</p>
      </div>
    </div>
  `

  const html = emailDocument({
    title: `Захиалгын баримт — ${order.orderNo}`,
    preheader: `Захиалга ${order.orderNo} баталгаажлаа. Нийт ${formatMnt(order.total)}.`,
    body,
  })

  return { html, text }
}
