import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Replaces window.confirm() for destructive admin actions — the browser
 * dialog can't be styled, blocks the whole tab (including the busy state
 * that would otherwise show), and on some browsers is easy to blow through
 * with a reflex double-click.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Устгах',
  cancelLabel = 'Цуцлах',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="modal" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="modal__card modal__card--sm">
        <div className="modal__head">
          <h2>{title}</h2>
        </div>

        <div className="modal__body">
          <p>{message}</p>
        </div>

        <div className="modal__foot">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
