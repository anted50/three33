import { toRichHtml } from './rich-text'

/**
 * Product descriptions, shaped into sections for the product page.
 *
 * Admins mark a section in several ways: a paragraph that is only a bold
 * label ("IDEAL FOR"), the same label with a colon ("How to use :"), a bold
 * label run into the paragraph it introduces, one after a line break, or a
 * real heading. This turns all of them into `<h3>`, so the page can rule a
 * divider above each section. It runs at display time, on the sanitised HTML.
 * Stored descriptions and what the editor shows are left alone.
 */

/** Labels that start a section wherever they turn up in bold. */
const SECTION_LABELS = new Set(['ideal for', 'how to use'])

/** Whitespace, `&nbsp;`, line breaks and empty bold runs: filler around a label. */
const FILLER = String.raw`(?:\s|&nbsp;|<br>|<strong>(?:\s|&nbsp;)*</strong>)*`

/** A bold run with no paragraph or bold boundary inside it. */
const STRONG = String.raw`<strong>((?:(?!</?(?:p|strong)>)[\s\S])*?)</strong>`

/** A paragraph that is a single bold run and nothing else. */
const LONE_STRONG_P = new RegExp(`<p>${FILLER}${STRONG}${FILLER}</p>`, 'g')

/** Any bold run, with the filler and colon around it, for in-text labels. */
const STRONG_ANYWHERE = new RegExp(
  `(?:<br>|\\s|&nbsp;)*${STRONG}(?:<strong>(?:\\s|&nbsp;)*</strong>|<br>|\\s|&nbsp;|:)*`,
  'g',
)

const EMPTY_P = /<p>(?:\s|&nbsp;|<br>)*<\/p>/g

/** The label as text: tags gone, spaces collapsed, a trailing colon dropped. */
function labelText(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s:]+$/, '')
    .trim()
}

function heading(label: string): string {
  return `<h3>${label}</h3>`
}

/**
 * True when `offset` falls inside an open `<tag>` of the sanitised `html`.
 * The sanitiser leaves these tags flat (no `<p>` in a `<p>`, no nested
 * lists in descriptions), so the last opening against the last closing
 * before `offset` is enough.
 */
function insideElement(html: string, offset: number, tag: 'p' | 'h3' | 'li'): boolean {
  const before = html.slice(0, offset)
  return before.lastIndexOf(`<${tag}`) > before.lastIndexOf(`</${tag}>`)
}

export function toDescriptionHtml(value: string | null | undefined): string {
  let html = toRichHtml(value)
  if (html === '') return ''

  // A paragraph that is only bold is a heading. An empty one is dropped.
  html = html.replace(LONE_STRONG_P, (_, inner: string) => {
    const label = labelText(inner)
    return label === '' ? '' : heading(label)
  })

  // A known label inside running text splits the paragraph around it.
  html = html.replace(
    STRONG_ANYWHERE,
    (match: string, inner: string, offset: number, whole: string) => {
      const label = labelText(inner)
      if (!SECTION_LABELS.has(label.toLowerCase())) return match
      // Already a heading, or a list item: lifting it would put an <h3>
      // inside an <h3> or break the list apart.
      if (insideElement(whole, offset, 'h3')) return match
      if (insideElement(whole, offset, 'li')) return match
      return insideElement(whole, offset, 'p')
        ? `</p>${heading(label)}<p>`
        : heading(label)
    },
  )

  return html.replace(EMPTY_P, '').trim()
}
