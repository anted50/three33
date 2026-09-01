import { useState, type ReactNode } from 'react'
import { RichTextEditor } from '~/components/rich-text-editor'
import { clearValidity, localizeValidity } from '~/lib/form-messages'
import { SLUG_RE, slugify } from '~/lib/slugify'

export interface ProductFormValues {
  nameMn: string
  nameEn: string
  slug: string
  categoryId: string
  brandLine: string
  descriptionMn: string
  status: 'draft' | 'active' | 'archived'
}

interface ProductFormProps {
  categories: Array<{ id: string; nameMn: string }>
  initial: ProductFormValues
  /** Off when editing: the slug is the product's URL and its stability is
   * worth more than letting a typo be fixed here. */
  slugEditable?: boolean
  submitLabel: string
  busyLabel: string
  onSubmit: (values: ProductFormValues, form: FormData) => Promise<void>
  /** Fires on every keystroke in "Нэр (EN)" — the new-product route uses this
   * to keep its auto-generated variant SKUs in sync with the product name. */
  onNameEnChange?: (nameEn: string) => void
  /** Extra fields rendered inside the same <form>, above the submit button —
   * the new-product route uses this for its variant rows and images. */
  children?: ReactNode
}

/**
 * Product-level fields shared by the create and edit admin pages, so the two
 * flows can't drift into asking for the same information two different ways.
 * Variant rows are not part of this form: creation collects them alongside it,
 * editing already has its own table for that.
 */
export function ProductForm({
  categories,
  initial,
  slugEditable = true,
  submitLabel,
  busyLabel,
  onSubmit,
  onNameEnChange,
  children,
}: ProductFormProps) {
  const [nameMn, setNameMn] = useState(initial.nameMn)
  const [nameEn, setNameEn] = useState(initial.nameEn)
  const [slug, setSlug] = useState(initial.slug)
  // Once there is an initial slug (editing, or a create draft resumed) typing
  // in the name must not clobber a slug someone already chose.
  const [slugTouched, setSlugTouched] = useState(initial.slug !== '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      {error && <p className="error">{error}</p>}

      <form
        className="adm__card adm__pad"
        onInvalidCapture={localizeValidity}
        onInput={clearValidity}
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)

          if (!SLUG_RE.test(slug)) {
            setError('Slug зөвхөн латин жижиг үсэг, тоо, зураас байж болно')
            return
          }

          const form = new FormData(event.currentTarget)

          setBusy(true)
          try {
            await onSubmit(
              {
                nameMn,
                nameEn,
                slug,
                categoryId: String(form.get('categoryId') ?? ''),
                brandLine: String(form.get('brandLine') ?? ''),
                descriptionMn: String(form.get('descriptionMn') ?? ''),
                status: form.get('status') as ProductFormValues['status'],
              },
              form,
            )
          } catch (err) {
            setError(
              err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="adm__cols">
          <label className="field">
            <span>Нэр (МН)</span>
            <input
              name="nameMn"
              value={nameMn}
              required
              onChange={(e) => {
                setNameMn(e.target.value)
                if (!slugTouched) setSlug(slugify(e.target.value))
              }}
            />
          </label>

          <label className="field">
            <span>Нэр (EN)</span>
            <input
              name="nameEn"
              value={nameEn}
              required
              onChange={(e) => {
                setNameEn(e.target.value)
                onNameEnChange?.(e.target.value)
              }}
            />
          </label>
        </div>

        <label className="field">
          <span>Slug</span>
          <input
            name="slug"
            value={slug}
            required
            disabled={!slugEditable}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value)
            }}
          />
          {slugEditable ? (
            <small>Нэрнээс автоматаар үүснэ, шаардлагатай бол засаж болно</small>
          ) : (
            <small>Slug бол бүтээгдэхүүний хаяг тул засах боломжгүй</small>
          )}
        </label>

        <div className="adm__cols">
          <label className="field">
            <span>Ангилал</span>
            <select name="categoryId" defaultValue={initial.categoryId}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameMn}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Брэнд шугам</span>
            <input name="brandLine" defaultValue={initial.brandLine} />
          </label>
        </div>

        <div className="field">
          <span>Тайлбар (МН)</span>
          <RichTextEditor
            name="descriptionMn"
            initialValue={initial.descriptionMn}
            placeholder="Бүтээгдэхүүний тайлбар, найрлага, хэрэглэх заавар…"
          />
          <small>
            Догол мөр, цэгтэй жагсаалт, тод бичиглэл хадгалагдана
          </small>
        </div>

        <label className="field">
          <span>Төлөв</span>
          <select name="status" defaultValue={initial.status}>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        </label>

        {children}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
      </form>
    </>
  )
}
