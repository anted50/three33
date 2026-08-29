import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '~/components/confirm-dialog'
import { ImageUrlEditor, type ImageEntry } from '~/components/image-url-editor'
import { ProductForm } from '~/components/product-form'
import { TrashIcon } from '~/components/admin-icons'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import { generateSku } from '~/lib/sku'
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

function ProductAdmin() {
  const { product, categories } = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmSplitId, setConfirmSplitId] = useState<string | null>(null)

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
        onSubmit={async (values) => {
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
          await router.invalidate()
        }}
      />

      {error && <p className="error">{error}</p>}

      <ProductImages slug={product.slug} initial={product.images} />

      <section className="adm__card">
        <div className="adm__cardhead">
          <h2>Хувилбар</h2>
        </div>

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
            {product.variants.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                busy={busy === variant.id}
                canSplit={product.variants.length > 1}
                onRequestSplit={() => setConfirmSplitId(variant.id)}
                onSave={async (price, stockQty, isActive) => {
                  setBusy(variant.id)
                  setError(null)
                  try {
                    await setVariant({
                      data: { variantId: variant.id, price, stockQty, isActive },
                    })
                    await router.invalidate()
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа',
                    )
                  } finally {
                    setBusy(null)
                  }
                }}
                onRequestDelete={() => setConfirmDeleteId(variant.id)}
              />
            ))}
          </tbody>
        </table>

        <p className="adm__muted adm__pad">
          Нөөц өөрчлөх бүрд inventory_ledger-т бичлэг үүснэ.
        </p>

        <AddVariantForm slug={product.slug} nameEn={product.nameEn} />
      </section>

      {confirmSplitId && (
        <ConfirmDialog
          title="Хувилбарыг салгах"
          message={`"${
            product.variants.find((v) => v.id === confirmSplitId)?.sku ?? ''
          }" хувилбарыг тусдаа бараа болгох уу? Зураг, тайлбар, ангилал, төлөв хуулагдана. SKU, үнэ, нөөц болон захиалгын түүх хэвээрээ үлдэнэ.`}
          busy={busy === confirmSplitId}
          confirmLabel="Салгах"
          onCancel={() => setConfirmSplitId(null)}
          onConfirm={async () => {
            const variantId = confirmSplitId
            setBusy(variantId)
            setError(null)
            try {
              const { slug } = await splitVariant({ data: { variantId } })
              setConfirmSplitId(null)
              // Straight to the new listing — it needs its own name and images
              // reviewed before anyone would call it done.
              await router.navigate({
                to: '/admin/products/$slug',
                params: { slug },
              })
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Салгахад алдаа гарлаа')
            } finally {
              setBusy(null)
            }
          }}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Хувилбар устгах"
          message={`"${
            product.variants.find((v) => v.id === confirmDeleteId)?.sku ?? ''
          }" хувилбарыг устгах уу? Энэ үйлдлийг буцаах боломжгүй.`}
          busy={busy === confirmDeleteId}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={async () => {
            const variantId = confirmDeleteId
            setBusy(variantId)
            setError(null)
            try {
              await deleteVariant({ data: { variantId } })
              await router.invalidate()
              setConfirmDeleteId(null)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Устгахад алдаа гарлаа')
            } finally {
              setBusy(null)
            }
          }}
        />
      )}
    </>
  )
}

interface VariantDraft {
  sku: string
  size: string
  price: string
  stockQty: string
}

const emptyDraft: VariantDraft = { sku: '', size: '', price: '0', stockQty: '0' }

/**
 * Adds a new size, color, or any other variation to a product that already
 * exists — the create form collects the first variant, this covers the ones
 * that show up later (a supplier adds a size, say).
 */
function AddVariantForm({ slug, nameEn }: { slug: string; nameEn: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<VariantDraft>({ ...emptyDraft })
  const [skuTouched, setSkuTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function patch(next: Partial<VariantDraft>) {
    setDraft((row) => ({ ...row, ...next }))
  }

  function changeSize(size: string) {
    setDraft((row) => ({
      ...row,
      size,
      sku: skuTouched ? row.sku : generateSku(nameEn, size),
    }))
  }

  async function submit() {
    setError(null)

    const price = Number(draft.price)
    const stockQty = Number(draft.stockQty)

    if (draft.sku.trim() === '') {
      setError('SKU шаардлагатай')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Үнэ буруу байна')
      return
    }
    if (!Number.isInteger(stockQty) || stockQty < 0) {
      setError('Нөөц буруу байна')
      return
    }

    setBusy(true)
    try {
      await addVariant({
        data: {
          slug,
          variant: {
            sku: draft.sku.trim(),
            size: draft.size.trim() || undefined,
            price: tugrikToMungu(price),
            stockQty,
          },
        },
      })
      await router.invalidate()
      setDraft({ ...emptyDraft })
      setSkuTouched(false)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

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
      <div className="varrow">
        <div className="adm__cols">
          <label className="field">
            <span>SKU</span>
            <input
              value={draft.sku}
              placeholder="UD-DP-30"
              onChange={(e) => {
                patch({ sku: e.target.value })
                setSkuTouched(true)
              }}
            />
            <small>
              Нэр, хэмжээгээр автоматаар бөглөнө — дотоод код тул шаардлагатай бол засаж
              болно
            </small>
          </label>

          <label className="field">
            <span>Хэмжээ</span>
            <input
              value={draft.size}
              placeholder="100g"
              onChange={(e) => changeSize(e.target.value)}
            />
          </label>
        </div>

        <div className="adm__cols">
          <label className="field">
            <span>Үнэ (₮)</span>
            <input
              value={draft.price}
              inputMode="numeric"
              onChange={(e) => patch({ price: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Нөөц</span>
            <input
              value={draft.stockQty}
              inputMode="numeric"
              onChange={(e) => patch({ stockQty: e.target.value })}
            />
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="adm__actions">
          <button type="button" className="btn btn--sm" disabled={busy} onClick={submit}>
            {busy ? 'Хадгалж байна…' : 'Хувилбар нэмэх'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              setDraft({ ...emptyDraft })
              setSkuTouched(false)
              setError(null)
            }}
          >
            Цуцлах
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductImages({
  slug,
  initial,
}: {
  slug: string
  initial: Array<{ url: string; alt: string | null }>
}) {
  const router = useRouter()
  const [images, setImages] = useState<ImageEntry[]>(
    initial.map((i) => ({ url: i.url, alt: i.alt ?? '' })),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <section className="adm__card adm__pad">
      <h2 className="adm__cardhead adm__cardhead--flush">Зураг</h2>

      <ImageUrlEditor images={images} onChange={setImages} />

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
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
            setError(
              err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Хадгалж байна…' : 'Зураг хадгалах'}
      </button>
    </section>
  )
}

interface VariantRowProps {
  variant: {
    id: string
    sku: string
    size: string | null
    price: number
    stockQty: number
    isActive: boolean
  }
  busy: boolean
  /** Off for the last variant: splitting it would leave nothing behind. */
  canSplit: boolean
  onSave: (price: number, stockQty: number, isActive: boolean) => Promise<void>
  onRequestSplit: () => void
  onRequestDelete: () => void
}

function VariantRow({
  variant,
  busy,
  canSplit,
  onSave,
  onRequestSplit,
  onRequestDelete,
}: VariantRowProps) {
  // Editing happens in tugrik because that is what a shop owner thinks in;
  // it converts back to mungu on save, in the one place that is allowed to.
  const [price, setPrice] = useState(String(munguToTugrik(variant.price)))
  const [stock, setStock] = useState(String(variant.stockQty))
  const [active, setActive] = useState(variant.isActive)

  const dirty =
    price !== String(munguToTugrik(variant.price)) ||
    stock !== String(variant.stockQty) ||
    active !== variant.isActive

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
        <div className="adm__rowactions">
          <button
            type="button"
            className="btn btn--sm"
            disabled={!dirty || busy}
            onClick={() => {
              const tugrik = Number(price)
              const qty = Number(stock)
              if (!Number.isFinite(tugrik) || !Number.isInteger(qty)) return
              void onSave(tugrikToMungu(tugrik), qty, active)
            }}
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
        <div className="adm__muted adm__hint">{formatMnt(variant.price)}</div>
      </td>
    </tr>
  )
}
