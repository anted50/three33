import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { requestAdminLogin, verifyAdminLogin } from '~/lib/server/admin/auth'

export const Route = createFileRoute('/admin/login')({
  component: AdminLogin,
})

type Step = 'email' | 'code'

function AdminLogin() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const router = useRouter()

  async function sendCode(target: string) {
    setBusy(true)
    setError(null)
    try {
      await requestAdminLogin({ data: { email: target } })
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Алдаа гарлаа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adm__unlock">
      {step === 'email' ? (
        <form
          className="adm__card adm__unlockcard"
          onSubmit={async (event) => {
            event.preventDefault()
            const target = String(
              new FormData(event.currentTarget).get('email') ?? '',
            )
              .trim()
              .toLowerCase()
            if (target) {
              setEmail(target)
              await sendCode(target)
            }
          }}
        >
          <h1>Админ нэвтрэлт</h1>
          <p className="adm__muted">
            Имэйл хаягаа оруулбал 6 оронтой код илгээнэ.
          </p>

          <label className="field">
            <span>Имэйл</span>
            <input
              name="email"
              type="email"
              autoFocus
              required
              autoComplete="email"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Илгээж байна…' : 'Код авах'}
          </button>
        </form>
      ) : (
        <form
          className="adm__card adm__unlockcard"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            setBusy(true)

            const code = String(
              new FormData(event.currentTarget).get('code') ?? '',
            ).trim()

            try {
              const result = await verifyAdminLogin({ data: { email, code } })
              if (result.ok) {
                await router.invalidate()
                await navigate({ to: '/admin' })
              } else {
                setError(result.error ?? 'Алдаа гарлаа')
                setBusy(false)
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Алдаа гарлаа')
              setBusy(false)
            }
          }}
        >
          <h1>Код баталгаажуулах</h1>
          <p className="adm__muted">
            {email} рүү илгээсэн 6 оронтой кодыг оруулна уу.
          </p>

          <label className="field">
            <span>Код</span>
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              autoComplete="one-time-code"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Шалгаж байна…' : 'Нэвтрэх'}
          </button>

          <button
            type="button"
            className="linkish"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() => {
              setError(null)
              setStep('email')
            }}
          >
            Өөр имэйл ашиглах
          </button>
        </form>
      )}
    </div>
  )
}
