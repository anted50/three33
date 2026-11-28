import { useEffect, useState, type CSSProperties } from 'react'
import type { OrderStatus } from '~/db/schema'
import { assert } from '~/lib/assert'
import { STATUS_LABEL } from '~/lib/order-status'

export { STATUS_LABEL }

/** Visual weight follows what needs attention, not the enum order. */
const TONE: Record<OrderStatus, string> = {
  pending_payment: 'wait',
  paid: 'done',
  processing: 'ok',
  shipped: 'ok',
  delivered: 'blue',
  cancelled: 'dead',
  expired: 'dead',
  refunded: 'warn',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className="badge2" data-tone={TONE[status]}>
      {STATUS_LABEL[status]}
    </span>
  )
}

/** How long a copy button shows its outcome before reading as a button again. */
const COPY_OUTCOME_MS = 1600

type CopyOutcome = 'idle' | 'copied' | 'failed'

/**
 * A button that copies `text` to the clipboard. It only says "copied" once
 * the write has gone through: the clipboard is missing on an insecure origin
 * and can be refused, and a button that claims success anyway sends an admin
 * off to paste something that is not there.
 */
export function CopyButton({
  text,
  label,
  className,
  style,
}: {
  text: string
  label: string
  className: string
  style?: CSSProperties
}) {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle')

  useEffect(() => {
    if (outcome === 'idle') return
    const timer = window.setTimeout(() => setOutcome('idle'), COPY_OUTCOME_MS)
    return () => window.clearTimeout(timer)
  }, [outcome])

  async function copy() {
    assert(text.length > 0, 'CopyButton: nothing to copy')
    if (!navigator.clipboard?.writeText) {
      setOutcome('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setOutcome('copied')
    } catch (error) {
      console.error('Clipboard write failed:', error)
      setOutcome('failed')
    }
  }

  return (
    <button type="button" className={className} style={style} onClick={copy}>
      {copyButtonText(outcome, label)}
    </button>
  )
}

function copyButtonText(outcome: CopyOutcome, label: string): string {
  if (outcome === 'copied') return '✓ Хуулсан'
  if (outcome === 'failed') return 'Хуулж чадсангүй'
  return label
}
