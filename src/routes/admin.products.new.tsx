import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ProductForm } from '~/components/product-form'
import { tugrikToMungu } from '~/lib/money'
import { createProduct, getCategoryOptions } from '~/lib/server/admin/admin'

export const Route = createFileRoute('/admin/products/new')({
  loader: () => getCategoryOptions(),
  component: NewProduct,
})

function NewProduct() {
  const categories = Route.useLoaderData()
  const navigate = useNavigate()

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
        onSubmit={async (values, form) => {
          const price = Number(form.get('price'))
          const stockQty = Number(form.get('stockQty'))

          if (!Number.isFinite(price) || price < 0) {
            throw new Error('Үнэ буруу байна')
          }
          if (!Number.isInteger(stockQty) || stockQty < 0) {
            throw new Error('Нөөц буруу байна')
          }

          const result = await createProduct({
            data: {
              slug: values.slug,
              nameMn: values.nameMn,
              nameEn: values.nameEn,
              descriptionMn: values.descriptionMn || undefined,
              categoryId: values.categoryId || undefined,
              brandLine: values.brandLine || undefined,
              status: values.status,
              sku: String(form.get('sku') ?? ''),
              size: String(form.get('size') ?? '') || undefined,
              price: tugrikToMungu(price),
              stockQty,
            },
          })

          await navigate({
            to: '/admin/products/$slug',
            params: { slug: result.slug },
          })
        }}
      >
        <h2 className="adm__cardhead">Эхний хувилбар</h2>

        <div className="adm__cols">
          <label className="field">
            <span>SKU</span>
            <input name="sku" required />
          </label>

          <label className="field">
            <span>Хэмжээ</span>
            <input name="size" />
          </label>
        </div>

        <div className="adm__cols">
          <label className="field">
            <span>Үнэ (₮)</span>
            <input name="price" inputMode="numeric" required defaultValue="0" />
          </label>

          <label className="field">
            <span>Нөөц</span>
            <input
              name="stockQty"
              inputMode="numeric"
              required
              defaultValue="0"
            />
          </label>
        </div>
      </ProductForm>
    </>
  )
}
