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
  renameCategory,
  setCategorySortOrder,
} from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/categories')({
  loader: () => getCategories(),
  component: Categories,
})

type Category = Awaited<ReturnType<typeof getCategories>>[number]

interface CategoryChanges {
  names?: { nameMn: string; nameEn: string }
  sortOrder?: number
}

/** Mirrors the server's upper bound on a category's sort order. */
const MAX_SORT_ORDER = 9999

/** A whole number from 0 to MAX_SORT_ORDER; null for blank or anything else. */
function parseSortOrder(text: string): number | null {
  if (text.trim() === '') return null
  const order = Number(text)
  if (!Number.isInteger(order)) return null
  if (order < 0) return null
  if (order > MAX_SORT_ORDER) return null
  return order
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** One save per row: only the parts the admin actually touched are sent. */
async function sendCategoryChanges(categoryId: string, changes: CategoryChanges) {
  if (changes.names) {
    await renameCategory({ data: { categoryId, ...changes.names } })
  }
  if (changes.sortOrder !== undefined) {
    await setCategorySortOrder({
      data: { categoryId, sortOrder: changes.sortOrder },
    })
  }
}

function Categories() {
  const categories = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // The category being saved or deleted; one at a time.
  const [busy, setBusy] = useState<string | null>(null)

  async function runForCategory(
    categoryId: string,
    failureMessage: string,
    action: () => Promise<void>,
  ) {
    if (busy !== null) return
    setBusy(categoryId)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err, failureMessage))
    } finally {
      setBusy(null)
    }
  }

  function remove(categoryId: string) {
    return runForCategory(categoryId, 'Устгахад алдаа гарлаа', async () => {
      await deleteCategory({ data: { categoryId } })
      await router.invalidate()
      setConfirmDeleteId(null)
    })
  }

  function save(categoryId: string, changes: CategoryChanges) {
    return runForCategory(categoryId, 'Хадгалахад алдаа гарлаа', async () => {
      await sendCategoryChanges(categoryId, changes)
      await router.invalidate()
    })
  }

  const target = categories.find((c) => c.id === confirmDeleteId)

  return (
    <>
      <header className="adm__head">
        <div>
          <h1>Ангилал</h1>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="adm__card">
        <CategoriesTable
          categories={categories}
          busyId={busy}
          onSave={save}
          onInvalid={setError}
          onRequestDelete={setConfirmDeleteId}
        />

        <AddCategoryForm />
      </section>

      {target && (
        <DeleteCategoryDialog
          category={target}
          busy={busy === target.id}
          onCancel={() => setConfirmDeleteId(null)}
          onDelete={() => void remove(target.id)}
        />
      )}
    </>
  )
}

function CategoriesTable({
  categories,
  busyId,
  onSave,
  onInvalid,
  onRequestDelete,
}: {
  categories: Category[]
  /** The category an action is running for, if any. */
  busyId: string | null
  onSave: (categoryId: string, changes: CategoryChanges) => Promise<void>
  onInvalid: (message: string) => void
  onRequestDelete: (categoryId: string) => void
}) {
  return (
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
            busy={busyId === category.id}
            onSave={(changes) => onSave(category.id, changes)}
            onInvalid={onInvalid}
            onRequestDelete={() => onRequestDelete(category.id)}
          />
        ))}
      </tbody>
    </table>
  )
}

/** A category still holding products cannot go: the dialog only says so. */
function DeleteCategoryDialog({
  category,
  busy,
  onCancel,
  onDelete,
}: {
  category: Category
  busy: boolean
  onCancel: () => void
  onDelete: () => void
}) {
  if (category.productCount > 0) {
    return (
      <ConfirmDialog
        title="Ангилал устгах"
        message={`"${category.nameMn}" ангилалыг устгах уу? Энэ ангилалд ${category.productCount} бүтээгдэхүүн хамаарч байгаа тул устгах боломжгүй.`}
        busy={busy}
        confirmLabel="Ойлголоо"
        onCancel={onCancel}
        onConfirm={onCancel}
      />
    )
  }

  return (
    <ConfirmDialog
      title="Ангилал устгах"
      message={`"${category.nameMn}" ангилалыг устгах уу? Энэ үйлдлийг буцаах боломжгүй.`}
      busy={busy}
      confirmLabel="Устгах"
      onCancel={onCancel}
      onConfirm={onDelete}
    />
  )
}

interface CategoryRowProps {
  category: Category
  busy: boolean
  onSave: (changes: CategoryChanges) => Promise<void>
  onInvalid: (message: string) => void
  onRequestDelete: () => void
}

/** Names and sort order are editable inline. The slug stays fixed — it is what
 * storefront links and the nav filter are built on, so changing it stays a
 * deliberate delete-and-recreate rather than a quiet inline edit. */
function CategoryRow({
  category,
  busy,
  onSave,
  onInvalid,
  onRequestDelete,
}: CategoryRowProps) {
  const [nameMn, setNameMn] = useState(category.nameMn)
  const [nameEn, setNameEn] = useState(category.nameEn)
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder))

  const namesDirty =
    nameMn.trim() !== category.nameMn || nameEn.trim() !== category.nameEn
  const orderDirty = sortOrder !== String(category.sortOrder)
  const dirty = namesDirty || orderDirty

  function save() {
    const changes: CategoryChanges = {}

    if (namesDirty) {
      if (nameMn.trim() === '' || nameEn.trim() === '') {
        onInvalid(`${category.slug}: нэр хоосон байж болохгүй`)
        return
      }
      changes.names = { nameMn: nameMn.trim(), nameEn: nameEn.trim() }
    }

    if (orderDirty) {
      const order = parseSortOrder(sortOrder)
      if (order === null) {
        onInvalid(`${category.slug}: эрэмбэ буруу байна`)
        return
      }
      changes.sortOrder = order
    }

    void onSave(changes)
  }

  return (
    <tr>
      <td>
        <input value={nameMn} onChange={(e) => setNameMn(e.target.value)} />
      </td>
      <td>
        <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </td>
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
        <CategoryRowActions
          busy={busy}
          canSave={dirty}
          onSave={save}
          onRequestDelete={onRequestDelete}
        />
      </td>
    </tr>
  )
}

function CategoryRowActions({
  busy,
  canSave,
  onSave,
  onRequestDelete,
}: {
  busy: boolean
  /** Only once something in the row has changed. */
  canSave: boolean
  onSave: () => void
  onRequestDelete: () => void
}) {
  return (
    <div className="adm__rowactions">
      <button
        type="button"
        className="btn btn--sm"
        disabled={!canSave || busy}
        onClick={onSave}
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
  )
}

/**
 * Collapsed by default, same as the "add variant" form on a product page —
 * a category is a rare, deliberate action, not something that needs its own
 * always-visible row of inputs. Closing it unmounts the form, so its fields
 * start empty next time.
 */
function AddCategoryForm() {
  const [open, setOpen] = useState(false)

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
      <NewCategoryFields onClose={() => setOpen(false)} />
    </div>
  )
}

function NewCategoryFields({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [nameMn, setNameMn] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [sortOrder, setSortOrder] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)

    if (!SLUG_RE.test(slug)) {
      setError('Slug зөвхөн латин жижиг үсэг, тоо, зураас байж болно')
      return
    }
    const order = parseSortOrder(sortOrder)
    if (order === null) {
      setError('Эрэмбэ буруу байна')
      return
    }

    setBusy(true)
    try {
      await createCategory({
        data: { slug, nameMn, nameEn, sortOrder: order },
      })
      await router.invalidate()
    } catch (err) {
      setError(errorMessage(err, 'Хадгалахад алдаа гарлаа'))
      setBusy(false)
      return
    }
    onClose()
  }

  return (
    <form
      className="varrow"
      onInvalidCapture={localizeValidity}
      onInput={clearValidity}
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        void submit()
      }}
    >
      <NewCategoryInputs
        nameMn={nameMn}
        nameEn={nameEn}
        slug={slug}
        sortOrder={sortOrder}
        onNameMnChange={(value) => {
          setNameMn(value)
          if (!slugTouched) setSlug(slugify(value))
        }}
        onNameEnChange={setNameEn}
        onSlugChange={(value) => {
          setSlugTouched(true)
          setSlug(value)
        }}
        onSortOrderChange={setSortOrder}
      />

      {error && <p className="error">{error}</p>}

      <div className="adm__actions">
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? 'Хадгалж байна…' : 'Ангилал нэмэх'}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={busy}
          onClick={onClose}
        >
          Цуцлах
        </button>
      </div>
    </form>
  )
}

function NewCategoryInputs({
  nameMn,
  nameEn,
  slug,
  sortOrder,
  onNameMnChange,
  onNameEnChange,
  onSlugChange,
  onSortOrderChange,
}: {
  nameMn: string
  nameEn: string
  slug: string
  sortOrder: string
  onNameMnChange: (value: string) => void
  onNameEnChange: (value: string) => void
  onSlugChange: (value: string) => void
  onSortOrderChange: (value: string) => void
}) {
  return (
    <>
      <div className="adm__cols">
        <label className="field">
          <span>Нэр (МН)</span>
          <input
            value={nameMn}
            required
            onChange={(e) => onNameMnChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Нэр (EN)</span>
          <input
            value={nameEn}
            required
            onChange={(e) => onNameEnChange(e.target.value)}
          />
        </label>
      </div>

      <div className="adm__cols">
        <label className="field">
          <span>Slug</span>
          <input
            value={slug}
            required
            onChange={(e) => onSlugChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Эрэмбэ</span>
          <input
            value={sortOrder}
            inputMode="numeric"
            onChange={(e) => onSortOrderChange(e.target.value)}
          />
        </label>
      </div>
    </>
  )
}
