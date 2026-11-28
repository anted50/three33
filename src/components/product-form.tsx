import { useState, type ReactNode } from 'react'
import { RichTextEditor } from '~/components/rich-text-editor'
import { assert } from '~/lib/assert'
import { clearValidity, localizeValidity } from '~/lib/form-messages'
import { SLUG_RE, slugify } from '~/lib/slugify'

const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const

type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export interface ProductFormValues {
  nameMn: string
  nameEn: string
  slug: string
  categoryId: string
  brandLine: string
  descriptionMn: string
  status: ProductStatus
}

interface ProductFormProps {
  categories: Array<{ id: string; nameMn: string }>
  initial: ProductFormValues
  /** Off when editing: the slug is the product's URL and its stability is
   * worth more than letting a typo be fixed here. */
  slugEditable?: boolean
  submitLabel: string
  busyLabel: string
  /** Throws to show its message above the form. */
  onSubmit: (values: ProductFormValues) => Promise<void>
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
 *
 * Names and slug are controlled, because the slug follows the name as it is
 * typed. The rest are read from the form on submit.
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

  async function submit(form: HTMLFormElement) {
    setError(null)

    if (!SLUG_RE.test(slug)) {
      setError('Slug зөвхөн латин жижиг үсэг, тоо, зураас байж болно')
      return
    }

    const values = readValues(new FormData(form), { nameMn, nameEn, slug })

    setBusy(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="error">{error}</p>}

      <form
        className="adm__card adm__pad"
        onInvalidCapture={localizeValidity}
        onInput={clearValidity}
        onSubmit={(event) => {
          event.preventDefault()
          if (busy) return
          void submit(event.currentTarget)
        }}
      >
        <NameFields
          nameMn={nameMn}
          nameEn={nameEn}
          onNameMnChange={(value) => {
            setNameMn(value)
            if (!slugTouched) setSlug(slugify(value))
          }}
          onNameEnChange={(value) => {
            setNameEn(value)
            onNameEnChange?.(value)
          }}
        />

        <SlugField
          value={slug}
          editable={slugEditable}
          onChange={(value) => {
            setSlugTouched(true)
            setSlug(value)
          }}
        />

        <UncontrolledFields categories={categories} initial={initial} />

        {children}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
      </form>
    </>
  )
}

function NameFields({
  nameMn,
  nameEn,
  onNameMnChange,
  onNameEnChange,
}: {
  nameMn: string
  nameEn: string
  onNameMnChange: (value: string) => void
  onNameEnChange: (value: string) => void
}) {
  return (
    <div className="adm__cols">
      <label className="field">
        <span>Нэр (МН)</span>
        <input
          name="nameMn"
          value={nameMn}
          required
          onChange={(e) => onNameMnChange(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Нэр (EN)</span>
        <input
          name="nameEn"
          value={nameEn}
          required
          onChange={(e) => onNameEnChange(e.target.value)}
        />
      </label>
    </div>
  )
}

function SlugField({
  value,
  editable,
  onChange,
}: {
  value: string
  editable: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>Slug</span>
      <input
        name="slug"
        value={value}
        required
        disabled={!editable}
        onChange={(e) => onChange(e.target.value)}
      />
      {editable ? (
        <small>Нэрнээс автоматаар үүснэ, шаардлагатай бол засаж болно</small>
      ) : (
        <small>Slug бол бүтээгдэхүүний хаяг тул засах боломжгүй</small>
      )}
    </label>
  )
}

/** The fields nothing else reacts to: read from the form only on submit. */
function UncontrolledFields({
  categories,
  initial,
}: {
  categories: ProductFormProps['categories']
  initial: ProductFormValues
}) {
  return (
    <>
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
          {PRODUCT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

function readValues(
  form: FormData,
  controlled: Pick<ProductFormValues, 'nameMn' | 'nameEn' | 'slug'>,
): ProductFormValues {
  const status = String(form.get('status') ?? '')
  // The <select> only offers these, so anything else is a bug in this form.
  assert(isProductStatus(status), `unknown product status: ${status}`)

  return {
    ...controlled,
    categoryId: String(form.get('categoryId') ?? ''),
    brandLine: String(form.get('brandLine') ?? ''),
    descriptionMn: String(form.get('descriptionMn') ?? ''),
    status,
  }
}

function isProductStatus(value: string): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly string[]).includes(value)
}
