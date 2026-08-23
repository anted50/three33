import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ImageUrlEditor, type ImageEntry } from '~/components/image-url-editor'
import { ProductForm } from '~/components/product-form'
import { tugrikToMungu } from '~/lib/money'
import { createProduct, getCategoryOptions } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/products/new')({
  loader: () => getCategoryOptions(),
  component: NewProduct,
})

interface VariantDraft {
  sku: string
  size: string
  price: string
  stockQty: string
}

const emptyVariant: VariantDraft = { sku: '', size: '', price: '0', stockQty: '0' }

function NewProduct() {
  const categories = Route.useLoaderData()
  const navigate = useNavigate()
  const [variants, setVariants] = useState<VariantDraft[]>([{ ...emptyVariant }])
  const [images, setImages] = useState<ImageEntry[]>([])

  function patchVariant(index: number, patch: Partial<VariantDraft>) {
    setVariants((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
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
        initial={{
          nameMn: '',
          nameEn: '',
          slug: '',
          categoryId: '',
          brandLine: '',
          descriptionMn: '',
          status: 'draft',
        }}
        submitLabel="Бүтээгдэхүүн үүсгэх"
        busyLabel="Хадгалж байна…"
        onSubmit={async (values) => {
          const parsed = variants.map((variant) => {
            const price = Number(variant.price)
            const stockQty = Number(variant.stockQty)

            if (variant.sku.trim() === '') {
              throw new Error('Хувилбар бүрд SKU шаардлагатай')
            }
            if (!Number.isFinite(price) || price < 0) {
              throw new Error(`${variant.sku}: үнэ буруу байна`)
            }
            if (!Number.isInteger(stockQty) || stockQty < 0) {
              throw new Error(`${variant.sku}: нөөц буруу байна`)
            }

            return {
              sku: variant.sku.trim(),
              size: variant.size.trim() || undefined,
              price: tugrikToMungu(price),
              stockQty,
            }
          })

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

          await navigate({
            to: '/admin/products/$slug',
            params: { slug: result.slug },
          })
        }}
      >
        <h2 className="adm__cardhead">Зураг</h2>
        <ImageUrlEditor images={images} onChange={setImages} />

        <h2 className="adm__cardhead">Хувилбар</h2>

        {variants.map((variant, i) => (
          <div key={i} className="varrow">
            <div className="adm__cols">
              <label className="field">
                <span>SKU</span>
                <input
                  value={variant.sku}
                  onChange={(e) => patchVariant(i, { sku: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Хэмжээ</span>
                <input
                  value={variant.size}
                  placeholder="100g"
                  onChange={(e) => patchVariant(i, { size: e.target.value })}
                />
              </label>
            </div>

            <div className="adm__cols">
              <label className="field">
                <span>Үнэ (₮)</span>
                <input
                  value={variant.price}
                  inputMode="numeric"
                  onChange={(e) => patchVariant(i, { price: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Нөөц</span>
                <input
                  value={variant.stockQty}
                  inputMode="numeric"
                  onChange={(e) => patchVariant(i, { stockQty: e.target.value })}
                />
              </label>
            </div>

            {variants.length > 1 && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() =>
                  setVariants((rows) => rows.filter((_, j) => j !== i))
                }
              >
                Хувилбар хасах
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setVariants((rows) => [...rows, { ...emptyVariant }])}
        >
          + Хувилбар нэмэх
        </button>
      </ProductForm>
    </>
  )
}
