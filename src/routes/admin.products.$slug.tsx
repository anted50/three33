import { useState } from 'react'
import { usePostHog } from '@posthog/react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { ImageUrlEditor, type ImageEntry } from '~/components/image-url-editor'
import {
  ProductForm,
  type ProductFormValues,
} from '~/components/product-form'
import { TrashIcon } from '~/components/admin-icons'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import { uniqueSku } from '~/lib/sku'
import {
  addVariant,
  deleteVariant,
  getCategoryOptions,
  getProductDetail,
  setProductImages,
  setVariant,
  splitVariant,
  updateProduct,
} from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/products/$slug')({
  loader: async ({ params }) => {
    const [product, categories] = await Promise.all([
      getProductDetail({ data: { slug: params.slug } }),
      getCategoryOptions(),
    ])
    return { product, categories }
  },
  component: ProductAdmin,
})

type Product = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>
type Variant = Product['variants'][number]

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** Whole or fractional tugrik, zero or more; null for blank or anything else. */
function parseTugrik(text: string): number | null {
  if (text.trim() === '') return null
  const tugrik = Number(text)
  if (!Number.isFinite(tugrik)) return null
  if (tugrik < 0) return null
  return tugrik
}

/** A whole count, zero or more; null for blank or anything else. */
function parseStockQuantity(text: string): number | null {
  if (text.trim() === '') return null
  const quantity = Number(text)
  if (!Number.isInteger(quantity)) return null
  if (quantity < 0) return null
  return quantity
}

function ProductAdmin() {
  const { product, categories } = Route.useLoaderData()

  if (!product) {
    return (
      <>
        <header className="adm__head">
          <h1>Бүтээгдэхүүн олдсонгүй</h1>
        </header>
        <Link to="/admin/products">← Буцах</Link>
      </>
    )
  }

  // Keyed by slug: moving to another product (a split lands on the new one)
  // keeps this route mounted, and every draft below is seeded from the
  // product once. Without the key the new product's page would show, and
  // save, the old product's names.
  return (
    <ProductEditor key={product.slug} product={product} categories={categories} />
  )
}

function ProductEditor({
  product,
  categories,
}: {
  product: Product
  categories: Array<{ id: string; nameMn: string }>
}) {
  const posthog = usePostHog()
  const router = useRouter()

  async function save(values: ProductFormValues) {
    await updateProduct({
      data: {
        slug: product.slug,
        nameMn: values.nameMn,
        nameEn: values.nameEn,
        descriptionMn: values.descriptionMn || undefined,
        categoryId: values.categoryId || undefined,
        brandLine: values.brandLine || undefined,
        status: values.status,
      },
    })
    posthog?.capture('product_updated', {
      product_slug: product.slug,
      status: values.status,
    })
    await router.invalidate()
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <p className="adm__muted">
            <Link to="/admin/products">Бүтээгдэхүүн</Link> ›
          </p>
          <h1>{product.nameMn}</h1>
        </div>
      </header>

      <ProductForm
        categories={categories}
        initial={{
          nameMn: product.nameMn,
          nameEn: product.nameEn,
          slug: product.slug,
          categoryId: product.categoryId ?? '',
          brandLine: product.brandLine ?? '',
          descriptionMn: product.descriptionMn ?? '',
          status: product.status,
        }}
        slugEditable={false}
        submitLabel="Хадгалах"
        busyLabel="Хадгалж байна…"
        onSubmit={save}
      />

      <ProductImages slug={product.slug} initial={product.images} />

      <VariantsSection product={product} />
    </>
  )
}

/** The variant table, the add form, and the split and delete confirmations. */
function VariantsSection({ product }: { product: Product }) {
  const {
    busy,
    error,
    setError,
    confirmSplitId,
    setConfirmSplitId,
    confirmDeleteId,
    setConfirmDeleteId,
    save,
    split,
    remove,
  } = useVariantActions()

  const splitTarget = product.variants.find((v) => v.id === confirmSplitId)
  const deleteTarget = product.variants.find((v) => v.id === confirmDeleteId)

  return (
    <>
      {error && <p className="error">{error}</p>}

      <section className="adm__card">
        <div className="adm__cardhead">
          <h2>Хувилбар</h2>
        </div>

        <VariantTable
          variants={product.variants}
          busyId={busy}
          onSave={save}
          onInvalid={setError}
          onRequestSplit={setConfirmSplitId}
          onRequestDelete={setConfirmDeleteId}
        />
        <AddVariantForm
          slug={product.slug}
          nameEn={product.nameEn}
          takenSkus={product.variants.map((v) => v.sku)}
        />
      </section>

      {splitTarget && (
        <ConfirmDialog
          title="Хувилбарыг салгах"
          message={`"${splitTarget.sku}" хувилбарыг тусдаа бараа болгох уу? Зураг, тайлбар, ангилал, төлөв хуулагдана. SKU, үнэ, нөөц болон захиалгын түүх хэвээрээ үлдэнэ.`}
          busy={busy === splitTarget.id}
          confirmLabel="Салгах"
          onCancel={() => setConfirmSplitId(null)}
          onConfirm={() => void split(splitTarget.id)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Хувилбар устгах"
          message={`"${deleteTarget.sku}" хувилбарыг устгах уу? Энэ үйлдлийг буцаах боломжгүй.`}
          busy={busy === deleteTarget.id}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => void remove(deleteTarget.id)}
        />
      )}
    </>
  )
}

/**
 * Save, split and delete, one action at a time: `busy` names the variant it
 * is running for, and a second action while one runs is ignored.
 */
function useVariantActions() {
  const posthog = usePostHog()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmSplitId, setConfirmSplitId] = useState<string | null>(null)

  async function runForVariant(
    variantId: string,
    failureMessage: string,
    action: () => Promise<void>,
  ) {
    if (busy !== null) return
    setBusy(variantId)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err, failureMessage))
    } finally {
      setBusy(null)
    }
  }

  function save(
    variantId: string,
    price: number,
    stockQty: number,
    isActive: boolean,
  ) {
    return runForVariant(variantId, 'Хадгалахад алдаа гарлаа', async () => {
      await setVariant({ data: { variantId, price, stockQty, isActive } })
      posthog?.capture('product_variant_updated', {
        is_active: isActive,
        stock_quantity: stockQty,
        unit_price: price,
        variant_id: variantId,
      })
      await router.invalidate()
    })
  }

  function split(variantId: string) {
    return runForVariant(variantId, 'Салгахад алдаа гарлаа', async () => {
      const { slug } = await splitVariant({ data: { variantId } })
      setConfirmSplitId(null)
      // Straight to the new listing — it needs its own name and images
      // reviewed before anyone would call it done.
      await router.navigate({ to: '/admin/products/$slug', params: { slug } })
    })
  }

  function remove(variantId: string) {
    return runForVariant(variantId, 'Устгахад алдаа гарлаа', async () => {
      await deleteVariant({ data: { variantId } })
      await router.invalidate()
      setConfirmDeleteId(null)
    })
  }

  return {
    busy,
    error,
    setError,
    confirmSplitId,
    setConfirmSplitId,
    confirmDeleteId,
    setConfirmDeleteId,
    save,
    split,
    remove,
  }
}

function VariantTable({
  variants,
  busyId,
  onSave,
  onInvalid,
  onRequestSplit,
  onRequestDelete,
}: {
  variants: Variant[]
  /** The variant an action is running for, if any. */
  busyId: string | null
  onSave: (
    variantId: string,
    price: number,
    stockQty: number,
    isActive: boolean,
  ) => Promise<void>
  onInvalid: (message: string) => void
  onRequestSplit: (variantId: string) => void
  onRequestDelete: (variantId: string) => void
}) {
  return (
    <table className="adm__table adm__table--form">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Хэмжээ</th>
          <th>Үнэ (₮)</th>
          <th>Нөөц</th>
          <th>Идэвхтэй</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {variants.map((variant) => (
          <VariantRow
            key={variant.id}
            variant={variant}
            busy={busyId === variant.id}
            canSplit={variants.length > 1}
            onSave={(price, stockQty, isActive) =>
              onSave(variant.id, price, stockQty, isActive)
            }
            onInvalid={onInvalid}
            onRequestSplit={() => onRequestSplit(variant.id)}
            onRequestDelete={() => onRequestDelete(variant.id)}
          />
        ))}
      </tbody>
    </table>
  )
}

interface VariantDraft {
  sku: string
  size: string
  price: string
  stockQty: string
}

/** The draft as addVariant takes it. Throws a message for the form. */
function parseDraft(draft: VariantDraft) {
  const price = parseTugrik(draft.price)
  const stockQty = parseStockQuantity(draft.stockQty)

  if (draft.sku.trim() === '') {
    throw new Error('Бүтээгдэхүүний Нэр (EN)-ээс SKU үүсгэж чадсангүй')
  }
  if (price === null) {
    throw new Error('Үнэ буруу байна')
  }
  if (stockQty === null) {
    throw new Error('Нөөц буруу байна')
  }

  return {
    sku: draft.sku.trim(),
    size: draft.size.trim() || undefined,
    price: tugrikToMungu(price),
    stockQty,
  }
}

interface AddVariantProps {
  slug: string
  nameEn: string
  /** SKUs already on this product, so a suggestion never duplicates one. */
  takenSkus: string[]
}

/**
 * Adds a new size, color, or any other variation to a product that already
 * exists — the create form collects the first variant, this covers the ones
 * that show up later (a supplier adds a size, say). Closing it unmounts the
 * form, so the next one starts from a fresh draft.
 */
function AddVariantForm(props: AddVariantProps) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="adm__pad">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => setOpen(true)}
        >
          + Хувилбар нэмэх
        </button>
      </div>
    )
  }

  return (
    <div className="adm__pad">
      <NewVariantForm {...props} onClose={() => setOpen(false)} />
    </div>
  )
}

function NewVariantForm({
  slug,
  nameEn,
  takenSkus,
  onClose,
}: AddVariantProps & { onClose: () => void }) {
  const router = useRouter()
  // The SKU is filled in on open, not on the first keystroke in "Хэмжээ": a
  // variant that differs by something other than size still gets a code.
  const [draft, setDraft] = useState<VariantDraft>(() => ({
    sku: uniqueSku(nameEn, '', takenSkus),
    size: '',
    price: '0',
    stockQty: '0',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await addVariant({ data: { slug, variant: parseDraft(draft) } })
      await router.invalidate()
    } catch (err) {
      setError(errorMessage(err, 'Хадгалахад алдаа гарлаа'))
      setBusy(false)
      return
    }
    onClose()
  }

  return (
    <div className="varrow">
      <VariantDraftFields
        draft={draft}
        onSizeChange={(size) =>
          setDraft((row) => ({
            ...row,
            size,
            sku: uniqueSku(nameEn, size, takenSkus),
          }))
        }
        onPatch={(patch) => setDraft((row) => ({ ...row, ...patch }))}
      />

      {error && <p className="error">{error}</p>}

      <div className="adm__actions">
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Хадгалж байна…' : 'Хувилбар нэмэх'}
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
    </div>
  )
}

function VariantDraftFields({
  draft,
  onSizeChange,
  onPatch,
}: {
  draft: VariantDraft
  onSizeChange: (size: string) => void
  onPatch: (patch: Partial<VariantDraft>) => void
}) {
  return (
    <>
      <p className="varrow__sku">
        <span>SKU</span>
        <code>{draft.sku || '—'}</code>
      </p>

      <div className="adm__cols">
        <label className="field">
          <span>Хэмжээ</span>
          <input
            value={draft.size}
            placeholder="100g"
            onChange={(e) => onSizeChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Үнэ (₮)</span>
          <input
            value={draft.price}
            inputMode="numeric"
            onChange={(e) => onPatch({ price: e.target.value })}
          />
        </label>
      </div>

      <div className="adm__cols">
        <label className="field">
          <span>Нөөц</span>
          <input
            value={draft.stockQty}
            inputMode="numeric"
            onChange={(e) => onPatch({ stockQty: e.target.value })}
          />
        </label>
      </div>
    </>
  )
}

function ProductImages({
  slug,
  initial,
}: {
  slug: string
  initial: Product['images']
}) {
  const router = useRouter()
  // A draft: edits stay here until "Зураг хадгалах" sends the whole list.
  const [images, setImages] = useState<ImageEntry[]>(() =>
    initial.map((image) => ({ url: image.url, alt: image.alt ?? '' })),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await setProductImages({
        data: {
          slug,
          images: images.map((image) => ({
            url: image.url,
            alt: image.alt || undefined,
          })),
        },
      })
      await router.invalidate()
    } catch (err) {
      setError(errorMessage(err, 'Хадгалахад алдаа гарлаа'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm__card adm__pad">
      <h2 className="adm__cardhead adm__cardhead--flush">Зураг</h2>

      <ImageUrlEditor images={images} onChange={setImages} />

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? 'Хадгалж байна…' : 'Зураг хадгалах'}
      </button>
    </section>
  )
}

interface VariantRowProps {
  variant: Variant
  busy: boolean
  /** Off for the last variant: splitting it would leave nothing behind. */
  canSplit: boolean
  /** Price in mungu. */
  onSave: (price: number, stockQty: number, isActive: boolean) => Promise<void>
  onInvalid: (message: string) => void
  onRequestSplit: () => void
  onRequestDelete: () => void
}

function VariantRow({
  variant,
  busy,
  canSplit,
  onSave,
  onInvalid,
  onRequestSplit,
  onRequestDelete,
}: VariantRowProps) {
  // Editing happens in tugrik because that is what a shop owner thinks in;
  // it converts back to mungu on save, in the one place that is allowed to.
  const savedPrice = String(munguToTugrik(variant.price))
  const savedStock = String(variant.stockQty)
  const [price, setPrice] = useState(savedPrice)
  const [stock, setStock] = useState(savedStock)
  const [active, setActive] = useState(variant.isActive)

  const dirty =
    price !== savedPrice || stock !== savedStock || active !== variant.isActive

  function save() {
    const tugrik = parseTugrik(price)
    const stockQty = parseStockQuantity(stock)
    if (tugrik === null) {
      onInvalid(`${variant.sku}: үнэ буруу байна`)
      return
    }
    if (stockQty === null) {
      onInvalid(`${variant.sku}: нөөц буруу байна`)
      return
    }
    void onSave(tugrikToMungu(tugrik), stockQty, active)
  }

  return (
    <tr>
      <td className="adm__mono">{variant.sku}</td>
      <td>{variant.size ?? '—'}</td>
      <td>
        <input
          value={price}
          inputMode="numeric"
          onChange={(e) => setPrice(e.target.value)}
          size={8}
        />
      </td>
      <td>
        <input
          value={stock}
          inputMode="numeric"
          onChange={(e) => setStock(e.target.value)}
          size={5}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      </td>
      <td className="adm__actionscell">
        <VariantRowActions
          busy={busy}
          canSave={dirty}
          canSplit={canSplit}
          onSave={save}
          onRequestSplit={onRequestSplit}
          onRequestDelete={onRequestDelete}
        />
        <div className="adm__muted adm__hint">{formatMnt(variant.price)}</div>
      </td>
    </tr>
  )
}

function VariantRowActions({
  busy,
  canSave,
  canSplit,
  onSave,
  onRequestSplit,
  onRequestDelete,
}: {
  busy: boolean
  /** Only once something in the row has changed. */
  canSave: boolean
  canSplit: boolean
  onSave: () => void
  onRequestSplit: () => void
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
      {canSplit && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          title="Энэ хувилбарыг тусдаа бараа болгох"
          disabled={busy}
          onClick={onRequestSplit}
        >
          Салгах
        </button>
      )}
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
