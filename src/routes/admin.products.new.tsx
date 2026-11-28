import { useState } from 'react'
import { usePostHog } from '@posthog/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ImageUrlEditor, type ImageEntry } from '~/components/image-url-editor'
import {
  ProductForm,
  type ProductFormValues,
} from '~/components/product-form'
import { tugrikToMungu } from '~/lib/money'
import { uniqueSku } from '~/lib/sku'
import { createProduct, getCategoryOptions } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/products/new')({
  loader: () => getCategoryOptions(),
  component: NewProduct,
})

/** Mirrors the server's cap on variants per new product. */
const MAX_VARIANTS = 20

interface VariantDraft {
  sku: string
  size: string
  price: string
  stockQty: string
}

const emptyVariant: VariantDraft = {
  sku: '',
  size: '',
  price: '0',
  stockQty: '0',
}

const emptyProduct: ProductFormValues = {
  nameMn: '',
  nameEn: '',
  slug: '',
  categoryId: '',
  brandLine: '',
  descriptionMn: '',
  status: 'draft',
}

/**
 * Re-derives every SKU in the draft, in row order. Codes are internal — they
 * name a variant for the shop's own picking and reconciliation, never for a
 * shopper — so they are generated rather than asked for, and re-derived as a
 * whole because adding or removing a row changes which suffixes are free.
 */
function withSkus(rows: VariantDraft[], nameEn: string): VariantDraft[] {
  const taken: string[] = []

  return rows.map((row) => {
    const sku = uniqueSku(nameEn, row.size, taken)
    if (sku) taken.push(sku)
    return { ...row, sku }
  })
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

/** The rows as createProduct takes them. Throws a message for the form. */
function parseVariants(rows: VariantDraft[], nameEn: string) {
  return withSkus(rows, nameEn).map((variant) => {
    const price = parseTugrik(variant.price)
    const stockQty = parseStockQuantity(variant.stockQty)

    // Unreachable while "Нэр (EN)" is a required field, but the code
    // is generated from it and a variant without one cannot be sold.
    if (variant.sku.trim() === '') {
      throw new Error('Нэр (EN)-ээс SKU үүсгэж чадсангүй')
    }
    if (price === null) {
      throw new Error(`${variant.sku}: үнэ буруу байна`)
    }
    if (stockQty === null) {
      throw new Error(`${variant.sku}: нөөц буруу байна`)
    }

    return {
      sku: variant.sku.trim(),
      size: variant.size.trim() || undefined,
      price: tugrikToMungu(price),
      stockQty,
    }
  })
}

function NewProduct() {
  const categories = Route.useLoaderData()
  const posthog = usePostHog()
  const navigate = useNavigate()
  const [nameEn, setNameEn] = useState('')
  const [variants, setVariants] = useState<VariantDraft[]>([{ ...emptyVariant }])
  const [images, setImages] = useState<ImageEntry[]>([])

  async function create(values: ProductFormValues) {
    const parsed = parseVariants(variants, values.nameEn)

    const result = await createProduct({
      data: {
        slug: values.slug,
        nameMn: values.nameMn,
        nameEn: values.nameEn,
        descriptionMn: values.descriptionMn || undefined,
        categoryId: values.categoryId || undefined,
        brandLine: values.brandLine || undefined,
        status: values.status,
        variants: parsed,
        images: images.map((image) => ({
          url: image.url,
          alt: image.alt || undefined,
        })),
      },
    })

    posthog?.capture('product_created', {
      image_count: images.length,
      product_slug: result.slug,
      status: values.status,
      variant_count: parsed.length,
    })

    await navigate({
      to: '/admin/products/$slug',
      params: { slug: result.slug },
    })
  }

  function changeNameEn(value: string) {
    setNameEn(value)
    setVariants((rows) => withSkus(rows, value))
  }

  return (
    <>
      <header className="adm__head">
        <div>
          <p className="adm__muted">
            <Link to="/admin/products">Бүтээгдэхүүн</Link> ›
          </p>
          <h1>Шинэ бүтээгдэхүүн</h1>
        </div>
      </header>

      <ProductForm
        categories={categories}
        initial={emptyProduct}
        submitLabel="Бүтээгдэхүүн үүсгэх"
        busyLabel="Хадгалж байна…"
        onNameEnChange={changeNameEn}
        onSubmit={create}
      >
        <h2 className="adm__cardhead adm__cardhead--flush">Зураг</h2>
        <ImageUrlEditor images={images} onChange={setImages} />

        <h2 className="adm__cardhead adm__cardhead--flush">Хувилбар</h2>
        <VariantDrafts
          variants={variants}
          nameEn={nameEn}
          onChange={setVariants}
        />
      </ProductForm>
    </>
  )
}

function VariantDrafts({
  variants,
  nameEn,
  onChange,
}: {
  variants: VariantDraft[]
  nameEn: string
  onChange: (update: (rows: VariantDraft[]) => VariantDraft[]) => void
}) {
  function patchRow(index: number, patch: Partial<VariantDraft>) {
    onChange((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    )
  }

  // A size change can change the row's SKU and every later row's suffix.
  function changeSize(index: number, size: string) {
    onChange((rows) =>
      withSkus(
        rows.map((row, rowIndex) =>
          rowIndex === index ? { ...row, size } : row,
        ),
        nameEn,
      ),
    )
  }

  function removeRow(index: number) {
    onChange((rows) =>
      withSkus(rows.filter((_, rowIndex) => rowIndex !== index), nameEn),
    )
  }

  function addRow() {
    onChange((rows) => withSkus([...rows, { ...emptyVariant }], nameEn))
  }

  return (
    <>
      {/* Keyed by position: every field is controlled from `variants` and
          a row holds no state of its own, so nothing sticks to the wrong row. */}
      {variants.map((variant, index) => (
        <VariantDraftRow
          key={index}
          variant={variant}
          canRemove={variants.length > 1}
          onSizeChange={(size) => changeSize(index, size)}
          onPatch={(patch) => patchRow(index, patch)}
          onRemove={() => removeRow(index)}
        />
      ))}

      <button
        type="button"
        className="btn btn--sm addvariant-btn"
        disabled={variants.length >= MAX_VARIANTS}
        onClick={addRow}
      >
        + Хувилбар нэмэх
      </button>
    </>
  )
}

function VariantDraftRow({
  variant,
  canRemove,
  onSizeChange,
  onPatch,
  onRemove,
}: {
  variant: VariantDraft
  canRemove: boolean
  onSizeChange: (size: string) => void
  onPatch: (patch: Partial<VariantDraft>) => void
  onRemove: () => void
}) {
  return (
    <div className="varrow">
      <p className="varrow__sku">
        <span>SKU</span>
        <code>{variant.sku || 'Нэр (EN) бөглөхөд үүснэ'}</code>
      </p>

      <div className="adm__cols">
        <label className="field">
          <span>Хэмжээ</span>
          <input
            value={variant.size}
            placeholder="100g"
            onChange={(e) => onSizeChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Үнэ (₮)</span>
          <input
            value={variant.price}
            inputMode="numeric"
            onChange={(e) => onPatch({ price: e.target.value })}
          />
        </label>
      </div>

      <div className="adm__cols">
        <label className="field">
          <span>Нөөц</span>
          <input
            value={variant.stockQty}
            inputMode="numeric"
            onChange={(e) => onPatch({ stockQty: e.target.value })}
          />
        </label>
      </div>

      {canRemove && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={onRemove}
        >
          Хувилбар хасах
        </button>
      )}
    </div>
  )
}
