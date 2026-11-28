import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { requestAdminLogin, verifyAdminLogin } from '~/lib/server/admin/auth'
import { clearValidity, localizeValidity } from '~/lib/form-messages'
import { assert } from '~/lib/assert'

export const Route = createFileRoute('/admin/login')({
    component: AdminLogin,
})

/**
 * Two steps: ask for the email, then for the code sent to it. Each step is
 * its own component, so switching steps unmounts one form and mounts the
 * other: a fresh DOM node, never the last step's input reused with its typed
 * value (two <form>s in the same slot of one component used to be reconciled
 * into one, carrying a half-typed code into the email field).
 */
function AdminLogin() {
    // Empty until a code has been sent; then the address it was sent to.
    const [email, setEmail] = useState('')

    return (
        <div className="adm__unlock">
            {email === '' ? (
                <EmailStep onCodeSent={setEmail} />
            ) : (
                <CodeStep
                    email={email}
                    onUseDifferentEmail={() => setEmail('')}
                />
            )}
        </div>
    )
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Алдаа гарлаа'
}

function EmailStep({ onCodeSent }: { onCodeSent: (email: string) => void }) {
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function sendCode(form: HTMLFormElement) {
        const email = String(new FormData(form).get('email') ?? '')
            .trim()
            .toLowerCase()
        // The field is required, so the browser stops an empty submit first.
        if (email === '') return

        setBusy(true)
        setError(null)
        try {
            await requestAdminLogin({ data: { email } })
        } catch (err) {
            setError(errorMessage(err))
            setBusy(false)
            return
        }
        onCodeSent(email)
    }

    return (
        <form
            className="adm__card adm__unlockcard"
            onInvalidCapture={localizeValidity}
            onInput={clearValidity}
            onSubmit={(event) => {
                event.preventDefault()
                if (busy) return
                void sendCode(event.currentTarget)
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
    )
}

function CodeStep({
    email,
    onUseDifferentEmail,
}: {
    email: string
    onUseDifferentEmail: () => void
}) {
    assert(email !== '', 'the code step needs the address the code went to')
    const navigate = useNavigate()
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    // Bumped on every failed attempt and used as the field's key below, so a
    // wrong code doesn't just sit there under the error message: React
    // remounts the field fresh.
    const [codeAttempt, setCodeAttempt] = useState(0)

    function fail(message: string) {
        setError(message)
        setBusy(false)
        setCodeAttempt((attempt) => attempt + 1)
    }

    async function verify(form: HTMLFormElement) {
        const code = String(new FormData(form).get('code') ?? '').trim()

        setError(null)
        setBusy(true)
        try {
            const result = await verifyAdminLogin({ data: { email, code } })
            if (!result.ok) {
                fail(result.error ?? 'Алдаа гарлаа')
                return
            }
            // Busy stays on: the page is about to leave for the dashboard.
            await router.invalidate()
            await navigate({ to: '/admin' })
        } catch (err) {
            fail(errorMessage(err))
        }
    }

    return (
        <form
            className="adm__card adm__unlockcard"
            onInvalidCapture={localizeValidity}
            onInput={clearValidity}
            onSubmit={(event) => {
                event.preventDefault()
                if (busy) return
                void verify(event.currentTarget)
            }}
        >
            <h1>Код баталгаажуулах</h1>
            <p className="adm__muted">
                {email} рүү илгээсэн 6 оронтой кодыг оруулна уу.
            </p>

            <CodeField key={codeAttempt} />

            {error && <p className="error">{error}</p>}

            <button type="submit" className="btn" disabled={busy}>
                {busy ? 'Шалгаж байна…' : 'Нэвтрэх'}
            </button>

            <button
                type="button"
                className="linkish"
                style={{ marginTop: 12 }}
                disabled={busy}
                onClick={onUseDifferentEmail}
            >
                Өөр имэйл ашиглах
            </button>
        </form>
    )
}

function CodeField() {
    return (
        <label className="field">
            <span>Код</span>
            <input
                name="code"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                required
                autoComplete="one-time-code"
            />
        </label>
    )
}
