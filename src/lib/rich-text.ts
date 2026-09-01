/**
 * A very small HTML allowlist for product descriptions.
 *
 * Descriptions are written by admins in the rich-text editor, but "written by
 * an admin" is not the same as "safe to inject into every shopper's page":
 * pasting from Word or a supplier's site drags in whole stylesheets, and an
 * admin account can be phished. So the stored HTML is rebuilt from scratch
 * here — text is escaped, only the tags below survive, and every attribute
 * except a safe `href` is dropped.
 */

/** Tags kept as-is. Everything else is dropped, though its text is kept. */
const ALLOWED = new Set([
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'h3',
  'blockquote',
  'a',
])

/** Presentational tags contentEditable emits for a meaning we already have. */
const ALIASES: Record<string, string> = {
  b: 'strong',
  i: 'em',
  strike: 's',
  del: 's',
  div: 'p',
  h1: 'h3',
  h2: 'h3',
  h4: 'h3',
}

/** Tags whose *content* is thrown away too, not just their markup. */
const DROP_CONTENT = new Set(['script', 'style', 'head', 'title', 'iframe'])

const VOID_TAGS = new Set(['br'])

/**
 * Tags a paragraph cannot legally contain. contentEditable happily produces
 * `<p><ul>…</ul></p>` when a paragraph is turned into a list, and re-parsing
 * that splits the paragraph in two — one of them empty — on the storefront.
 * Closing the paragraph here means what is stored is what renders.
 */
const BLOCKS_OUTSIDE_P = new Set(['p', 'ul', 'ol', 'h3', 'blockquote'])

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g
const HREF_RE = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i

function escapeText(text: string): string {
  return text
    // Entities already in the input are left whole: the editor serialises a
    // non-breaking space as `&nbsp;`, and escaping its ampersand would print
    // the entity itself on the storefront.
    .replace(
      /&(?!#\d{1,7};|#x[0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/g,
      '&amp;',
    )
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Decodes just enough to judge an href — `&#58;` has to read as a colon. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gi, '&')
}

function safeHref(attrs: string): string | null {
  const match = HREF_RE.exec(attrs)
  if (!match) return null

  const raw = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
    // Stripped because "java\tscript:" style spellings are how a blocked
    // scheme gets past a check that only looks at the literal prefix.
    .replace(/[\u0000-\u0020]/g, '')
    .trim()

  if (!raw) return null
  if (/^(https?:\/\/|mailto:|\/)/i.test(raw)) return escapeText(raw)
  return null
}

/**
 * Rebuilds `html` from its allowlisted parts. The result is safe to hand to
 * `dangerouslySetInnerHTML`; anything unrecognised is discarded rather than
 * escaped through, so mangled input degrades to plain text.
 */
export function sanitizeRichText(html: string): string {
  const out: string[] = []
  /** Open allowed tags, so closes can be matched and stray ones dropped. */
  const stack: string[] = []
  /** Nesting depth inside a drop-content tag; text is swallowed while > 0. */
  let dropping = 0
  let cursor = 0

  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    const [full, slash, rawName, attrs] = m
    const text = html.slice(cursor, m.index)
    cursor = m.index + full.length

    if (dropping === 0 && text) out.push(escapeText(text))

    const name = rawName!.toLowerCase()
    const closing = slash === '/'

    if (DROP_CONTENT.has(name)) {
      if (closing) dropping = Math.max(0, dropping - 1)
      else dropping += 1
      continue
    }
    if (dropping > 0) continue

    const tag = ALIASES[name] ?? name
    if (!ALLOWED.has(tag)) continue

    if (VOID_TAGS.has(tag)) {
      if (!closing) out.push(`<${tag}>`)
      continue
    }

    if (closing) {
      const at = stack.lastIndexOf(tag)
      if (at === -1) continue
      // Close what was opened inside it too, so the output stays balanced.
      while (stack.length > at) out.push(`</${stack.pop()}>`)
      continue
    }

    if (BLOCKS_OUTSIDE_P.has(tag) && stack[stack.length - 1] === 'p') {
      out.push(`</${stack.pop()}>`)
    }

    if (tag === 'a') {
      const href = safeHref(attrs ?? '')
      // A link with nowhere safe to go is just text.
      if (!href) continue
      out.push(`<a href="${href}" rel="noopener noreferrer" target="_blank">`)
    } else {
      out.push(`<${tag}>`)
    }
    stack.push(tag)
  }

  const tail = html.slice(cursor)
  if (dropping === 0 && tail) out.push(escapeText(tail))
  while (stack.length > 0) out.push(`</${stack.pop()}>`)

  return (
    out
      .join('')
      // Paragraphs left empty by the tidying above, and the `<p><br></p>` a
      // browser leaves behind on a deleted line, are spacing nobody chose.
      .replace(/<p>(<br>)*<\/p>/g, '')
      .trim()
  )
}

/** True when a value looks like it came from the rich-text editor. */
function looksLikeHtml(value: string): boolean {
  return /<\/?[a-zA-Z][a-zA-Z0-9]*(\s[^>]*)?>/.test(value)
}

/** Plain text with blank-line paragraphs -> the same shape in HTML. */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => `<p>${escapeText(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Normalises a stored description for display, or for seeding the editor.
 * Descriptions saved before the editor existed are plain text whose line
 * breaks were being flattened into one run-on paragraph — those are converted
 * here rather than migrated, so nothing in the database has to be rewritten.
 */
export function toRichHtml(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''
  return looksLikeHtml(trimmed)
    ? sanitizeRichText(trimmed)
    : plainTextToHtml(trimmed)
}

/** Rich text flattened for places that can only show characters. */
export function richTextToPlain(value: string | null | undefined): string {
  if (!value) return ''
  return sanitizeRichText(value)
    .replace(/<\/(p|li|h3|blockquote)>/g, '\n')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
