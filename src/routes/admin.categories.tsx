import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { TrashIcon } from '~/components/admin-icons'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { clearValidity, localizeValidity } from '~/lib/form-messages'
import { SLUG_RE, slugify } from '~/lib/slugify'
import {
  createCategory,
  deleteCategory,
  getCategories,
  setCategorySortOrder,
} from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/categories')({
  loader: () => getCategories(),
  component: Categories,
})

function Categories() {
  const categories = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function handleDelete(categoryId: string) {
    setBusy(categoryId)
    setError(null)
    try {
      await deleteCategory({ data: { categoryId } })
      await router.invalidate()
      setConfirmDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Устгахад алдаа гарлаа')
    } finally {
      setBusy(null)
    }
  }

  async function handleSaveSortOrder(categoryId: string, sortOrder: number) {
    setBusy(categoryId)
    setError(null)
    try {
      await setCategorySortOrder({ data: { categoryId, sortOrder } })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа')
    } finally {
      setBusy(null)
    }
  }

  const target = categories.find((c) => c.id === confirmDeleteId)

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Ангилал</h1>
          <p className="adm__muted">
            Бүтээгдэхүүний каталогийг ангилах бүлгүүд — дэлгүүрийн цэсэнд ашиглагдана
          </p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="adm__card">
        <table className="adm__table adm__table--form">
          <thead>
            <tr>
              <th>Нэр (МН)</th>
              <th>Нэр (EN)</th>
              <th>Slug</th>
              <th>Эрэмбэ</th>
              <th>Бараа</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && (
              <tr>
                <td colSpan={6} className="adm__muted">
                  Ангилал алга.
                </td>
              </tr>
            )}
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                busy={busy === category.id}
                onSaveSortOrder={(sortOrder) =>
                  handleSaveSortOrder(category.id, sortOrder)
                }
                onRequestDelete={() => setConfirmDeleteId(category.id)}
              />
            ))}
          </tbody>
        </table>

        <AddCategoryForm />
      </section>

      {target && (
        <ConfirmDialog
          title="Ангилал устгах"
          message={`"${target.nameMn}" ангилалыг устгах уу?${
            target.productCount > 0
              ? ` Энэ ангилалд ${target.productCount} бүтээгдэхүүн хамаарч байгаа тул устгах боломжгүй.`
              : ' Энэ үйлдлийг буцаах боломжгүй.'
          }`}
          busy={busy === target.id}
          confirmLabel={target.productCount > 0 ? 'Ойлголоо' : 'Устгах'}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={
            target.productCount > 0
              ? () => setConfirmDeleteId(null)
              : () => handleDelete(target.id)
          }
        />
      )}
    </>
  )
}

interface CategoryRowProps {
  category: {
    id: string
    nameMn: string
    nameEn: string
    slug: string
    sortOrder: number
    productCount: number
  }
  busy: boolean
  onSaveSortOrder: (sortOrder: number) => Promise<void>
  onRequestDelete: () => void
}

/** Only the sort order is editable here — renaming or re-slugging a category
 * changes the storefront nav and any links out there, so that stays a
 * deliberate delete-and-recreate rather than a quiet inline edit. */
function CategoryRow({
  category,
  busy,
  onSaveSortOrder,
  onRequestDelete,
}: CategoryRowProps) {
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder))
  const dirty = sortOrder !== String(category.sortOrder)

  return (
    <tr>
      <td>{category.nameMn}</td>
      <td>{category.nameEn}</td>
      <td className="adm__mono">{category.slug}</td>
      <td>
        <input
          value={sortOrder}
          inputMode="numeric"
          onChange={(e) => setSortOrder(e.target.value)}
          size={4}
        />
      </td>
      <td className="adm__num">{category.productCount}</td>
      <td className="adm__actionscell">
        <div className="adm__rowactions">
          <button
            type="button"
            className="btn btn--sm"
            disabled={!dirty || busy}
            onClick={() => {
              const n = Number(sortOrder)
              if (!Number.isInteger(n) || n < 0) return
              void onSaveSortOrder(n)
            }}
          >
            {busy ? '…' : 'Хадгалах'}
          </button>
          <button
            type="button"
            className="adm__iconbtn"
            title="Устгах"
            aria-label="Устгах"
            disabled={busy}
            onClick={onRequestDelete}
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

/**
 * Collapsed by default, same as the "add variant" form on a product page —
 * a category is a rare, deliberate action, not something that needs its own
 * always-visible row of inputs.
 */
function AddCategoryForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [nameMn, setNameMn] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [sortOrder, setSortOrder] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setNameMn('')
    setNameEn('')
    setSlug('')
    setSlugTouched(false)
    setSortOrder('0')
    setError(null)
  }

  if (!open) {
    return (
      <div className="adm__pad">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => setOpen(true)}
        >
          + Ангилал нэмэх
        </button>
      </div>
    )
  }

  return (
    <div className="adm__pad">
      <form
        className="varrow"
        onInvalidCapture={localizeValidity}
        onInput={clearValidity}
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)

          if (!SLUG_RE.test(slug)) {
            setError('Slug зөвхөн латин жижиг үсэг, тоо, зураас байж болно')
            return
          }
          const order = Number(sortOrder)
          if (!Number.isInteger(order) || order < 0) {
            setError('Эрэмбэ буруу байна')
            return
          }

          setBusy(true)
          try {
            await createCategory({
              data: { slug, nameMn, nameEn, sortOrder: order },
            })
            await router.invalidate()
            reset()
            setOpen(false)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="adm__cols">
          <label className="field">
            <span>Нэр (МН)</span>
            <input
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
            <input value={nameEn} required onChange={(e) => setNameEn(e.target.value)} />
          </label>
        </div>

        <div className="adm__cols">
          <label className="field">
            <span>Slug</span>
            <input
              value={slug}
              required
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
            />
          </label>

          <label className="field">
            <span>Эрэмбэ</span>
            <input
              value={sortOrder}
              inputMode="numeric"
              onChange={(e) => setSortOrder(e.target.value)}
            />
            <small>Жижиг тоо эхэнд харагдана</small>
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="adm__actions">
          <button type="submit" className="btn btn--sm" disabled={busy}>
            {busy ? 'Хадгалж байна…' : 'Ангилал нэмэх'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            onClick={() => {
              reset()
              setOpen(false)
            }}
          >
            Цуцлах
          </button>
        </div>
      </form>
    </div>
  )
}
