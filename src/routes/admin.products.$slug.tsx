import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ProductForm } from '~/components/product-form'
import { formatMnt, munguToTugrik, tugrikToMungu } from '~/lib/money'
import {
  getCategoryOptions,
  getProductDetail,
  setVariant,
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
              />
            ))}
          </tbody>
        </table>

        <p className="adm__muted adm__pad">
          Нөөц өөрчлөх бүрд inventory_ledger-т бичлэг үүснэ.
        </p>
      </section>
    </>
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
  onSave: (price: number, stockQty: number, isActive: boolean) => Promise<void>
}

function VariantRow({ variant, busy, onSave }: VariantRowProps) {
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
      <td>
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
        <div className="adm__muted adm__hint">{formatMnt(variant.price)}</div>
      </td>
    </tr>
  )
}
