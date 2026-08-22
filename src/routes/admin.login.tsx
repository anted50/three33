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
  // Bumped on every failed code attempt and used as the input's key below, so
  // a wrong code doesn't just sit there under the error message — React
  // remounts the field fresh, same as switching steps already does.
  const [codeAttempt, setCodeAttempt] = useState(0)
  // Bumped when "use a different email" is clicked, and used as that input's
  // key. The two steps are already separate <form> trees, so React itself
  // never carries a value across them — but the browser's own autofill does,
  // restoring the just-typed address into the fresh uncontrolled input by its
  // name/type/autocomplete. A new key means a genuinely new DOM node, which
  // autofill has no history for.
  const [emailAttempt, setEmailAttempt] = useState(0)
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
              key={emailAttempt}
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
                setCodeAttempt((n) => n + 1)
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Алдаа гарлаа')
              setBusy(false)
              setCodeAttempt((n) => n + 1)
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
              key={codeAttempt}
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
              setEmailAttempt((n) => n + 1)
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
