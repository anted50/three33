import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { unlockAdmin } from '~/lib/server/admin/gate'

export const Route = createFileRoute('/admin/unlock')({
  component: Unlock,
})

function Unlock() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const router = useRouter()

  return (
    <div className="adm__unlock">
      <form
        className="adm__card adm__unlockcard"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)

          const token = String(
            new FormData(event.currentTarget).get('token') ?? '',
          )

          const result = await unlockAdmin({ data: { token } })

          if (result.ok) {
            await router.invalidate()
            await navigate({ to: '/admin' })
          } else {
            setError(result.error ?? 'Алдаа гарлаа')
            setBusy(false)
          }
        }}
      >
        <h1>Админ нэвтрэлт</h1>
        <p className="adm__muted">
          Түр зуурын нэвтрэх түлхүүр. Жинхэнэ хэрэглэгчийн эрх удахгүй нэмэгдэнэ.
        </p>

        <label className="field">
          <span>Түлхүүр</span>
          <input
            name="token"
            type="password"
            autoFocus
            autoComplete="off"
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Шалгаж байна…' : 'Нэвтрэх'}
        </button>
      </form>
    </div>
  )
}
