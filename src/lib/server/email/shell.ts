/**
 * The document every transactional email is wrapped in.
 *
 * Both templates used to ship a bare `<div>` with `background:#ffffff` on it
 * and near-black text inside. That renders fine in a light client and breaks
 * in a dark one: iOS Mail, Apple Mail and Outlook apply their own dark
 * treatment to a message that has not declared a colour scheme, and their
 * treatment is not a clean inversion. They repaint container backgrounds dark
 * while leaving text colours that were set explicitly — which is every colour
 * in these templates — exactly as they are. The result is #0a0a0a on near
 * black: the mail arrives apparently blank.
 *
 * The fix is to declare that these emails are light-only and mean it, in the
 * three separate places clients look:
 *
 *   1. The two <meta> tags. Apple Mail and Outlook read `color-scheme` and
 *      `supported-color-schemes` from the head and skip their dark treatment
 *      entirely when a message says it only supports light.
 *   2. `color-scheme: only light` in CSS, for clients that read the property
 *      rather than the meta.
 *   3. !important overrides under prefers-color-scheme and Outlook.com's
 *      [data-ogsc] hook, for the ones that recolour anyway. These re-assert
 *      the light values rather than supplying a dark palette, because a
 *      receipt is a document — it should look the same as the paper one, and
 *      a two-palette monochrome template is two things to keep in step for no
 *      gain.
 *
 * Gmail's mobile apps invert regardless of all of this and cannot be opted
 * out of. What saves the mail there is that Gmail inverts foreground *and*
 * background together, so contrast survives; it is the partial recolouring
 * above that produced unreadable mail.
 */

/** Applied to anything that paints a light background under dark text. */
export const LIGHT_BG_CLASS = 'lightbg'

/** Applied to anything carrying explicitly-coloured text. */
export const KEEP_INK_CLASS = 'keepink'

export const PAPER = '#ffffff'
export const PANEL = '#f4f4f2'
export const INK = '#0a0a0a'
export const INK_SOFT = '#5c5c58'
export const INK_FAINT = '#8a8a86'
export const RULE = '#ececea'

/**
 * `preheader` is the line mail clients show after the subject in the inbox
 * list. Left out, they scrape the first text in the body, which here is the
 * logo's alt text — every message previewed as "Three33 Barbershop".
 */
export function emailDocument(options: {
  title: string
  preheader: string
  body: string
}): string {
  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${options.title}</title>
<style>
  :root { color-scheme: only light; supported-color-schemes: only light; }

  /* Belt and braces for clients that recolour despite the declaration above.
     Both selectors target the same rules; [data-ogsc] is the attribute
     Outlook.com adds to elements it has repainted. */
  @media (prefers-color-scheme: dark) {
    .${LIGHT_BG_CLASS} { background-color: ${PAPER} !important; }
    .panel { background-color: ${PANEL} !important; }
    .${KEEP_INK_CLASS}, .${KEEP_INK_CLASS} a { color: ${INK} !important; }
    .soft { color: ${INK_SOFT} !important; }
    .faint { color: ${INK_FAINT} !important; }
  }
  [data-ogsc] .${LIGHT_BG_CLASS} { background-color: ${PAPER} !important; }
  [data-ogsc] .panel { background-color: ${PANEL} !important; }
  [data-ogsc] .${KEEP_INK_CLASS},
  [data-ogsc] .${KEEP_INK_CLASS} a { color: ${INK} !important; }
  [data-ogsc] .soft { color: ${INK_SOFT} !important; }
  [data-ogsc] .faint { color: ${INK_FAINT} !important; }
</style>
</head>
<body class="${LIGHT_BG_CLASS}" bgcolor="${PAPER}" style="margin:0;padding:0;background-color:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${options.preheader}</div>
<!--
  A table, not a div, for the outermost box: Outlook's Word rendering engine
  ignores background-color on a block element but honours the bgcolor
  attribute on a table cell, and this cell is what stands between the message
  and Outlook's own window colour.
-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${LIGHT_BG_CLASS}" bgcolor="${PAPER}" style="background-color:${PAPER};border-collapse:collapse">
  <tr>
    <td align="center" style="padding:0">
${options.body}
    </td>
  </tr>
</table>
</body>
</html>`
}
