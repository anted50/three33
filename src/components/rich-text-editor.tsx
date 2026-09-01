import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { sanitizeRichText, toRichHtml } from '~/lib/rich-text'

interface RichTextEditorProps {
  /** Name of the hidden input the HTML is submitted under. */
  name: string
  /** Stored value: rich-text HTML, or plain text from before this existed. */
  initialValue: string
  placeholder?: string
}

interface ToolButton {
  label: string
  title: string
  command: string
  value?: string
  /** Rendered bold/italic/etc. so the button looks like what it does. */
  style?: CSSProperties
}

const TOOLS: ToolButton[] = [
  { label: 'B', title: 'Тод (Ctrl+B)', command: 'bold', style: { fontWeight: 700 } },
  {
    label: 'I',
    title: 'Налуу (Ctrl+I)',
    command: 'italic',
    style: { fontStyle: 'italic' },
  },
  {
    label: 'U',
    title: 'Доогуур зураас (Ctrl+U)',
    command: 'underline',
    style: { textDecoration: 'underline' },
  },
  { label: 'H', title: 'Дэд гарчиг', command: 'formatBlock', value: 'h3' },
  { label: '•—', title: 'Цэгтэй жагсаалт', command: 'insertUnorderedList' },
  { label: '1.', title: 'Дугаарласан жагсаалт', command: 'insertOrderedList' },
  { label: '⌫', title: 'Хэлбэржүүлэлт арилгах', command: 'removeFormat' },
]

/**
 * A deliberately small rich-text field for product descriptions.
 *
 * Descriptions used to be a plain <textarea> whose newlines were dropped on
 * the way to the storefront, so a carefully laid-out description arrived as
 * one wall of text. This keeps the paragraphs, and adds the two or three bits
 * of formatting a product page actually needs — bold, lists, a subheading.
 *
 * It is a contentEditable div rather than a bundled editor: the whole feature
 * is worth less than a megabyte of dependency, and the output goes through
 * the same allowlist on both ends (here, and again on the server) so nothing
 * downstream has to trust it.
 */
export function RichTextEditor({
  name,
  initialValue,
  placeholder,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState(() => toRichHtml(initialValue))
  const [empty, setEmpty] = useState(() => toRichHtml(initialValue) === '')

  // Written once, imperatively: React must never re-render this subtree from
  // state, or every keystroke would reset the caret to the start.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = toRichHtml(initialValue) || '<p><br></p>'
  }, [])

  function sync() {
    const el = ref.current
    if (!el) return
    const isEmpty = el.textContent?.trim() === '' && !el.querySelector('li')
    setEmpty(isEmpty)
    setHtml(isEmpty ? '' : sanitizeRichText(el.innerHTML))
  }

  function run(tool: ToolButton) {
    ref.current?.focus()
    document.execCommand(tool.command, false, tool.value)
    sync()
  }

  return (
    <div className="rte">
      <div className="rte__bar">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className="rte__btn"
            title={tool.title}
            style={tool.style}
            // The selection is lost the moment the button takes focus, and
            // execCommand works on the selection.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(tool)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <div
        ref={ref}
        className="rte__area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        data-empty={empty ? 'true' : undefined}
        onInput={sync}
        onBlur={sync}
        onPaste={(e) => {
          // Pasting from a supplier's page otherwise carries its fonts,
          // colours and tracking markup into our storefront.
          e.preventDefault()
          const clipboard = e.clipboardData
          const asHtml = clipboard.getData('text/html')
          const cleaned = asHtml
            ? sanitizeRichText(asHtml)
            : sanitizeRichText(
                clipboard
                  .getData('text/plain')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/\n/g, '<br>'),
              )
          document.execCommand('insertHTML', false, cleaned)
          sync()
        }}
      />

      <input type="hidden" name={name} value={html} />
    </div>
  )
}
