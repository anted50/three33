import { useEffect, useRef, useState } from 'react'
import { SHOP } from '~/lib/booking/shop'

/** How long the "Хуулсан" confirmation stays up. */
const COPIED_MS = 2000

/**
 * Copies the shop's number to the clipboard on tap instead of dialling it: a
 * tel: link drops desktop visitors into FaceTime or Skype, and on a phone it
 * starts a call the visitor may not have meant to make yet. They paste it
 * into their dialler when they are ready.
 *
 * Where the clipboard API is missing or refused (an insecure origin, an old
 * browser, a webview), the tap selects the visible number instead, so copying
 * it is one more step rather than a dead end. Attach `numberRef` to the
 * element that shows the number.
 */
export function usePhoneCopy() {
  const [copied, setCopied] = useState(false)
  const numberRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const selectNumber = () => {
    const node = numberRef.current
    const selection = window.getSelection()
    if (!node || !selection) return
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const copy = async () => {
    if (!navigator.clipboard?.writeText) {
      selectNumber()
      return
    }
    try {
      await navigator.clipboard.writeText(SHOP.phoneCopy)
      setCopied(true)
    } catch {
      selectNumber()
    }
  }

  return { copied, copy, numberRef }
}

/** Two overlapping sheets. Stroked in currentColor, like the header icons. */
export function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="copy-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/**
 * The tick that replaces CopyIcon once a copy has gone through. It mounts
 * fresh each time, so its CSS animation (a pop and a drawn stroke, see
 * .copy-icon--done in app.css) plays on every successful copy.
 */
export function CopiedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="copy-icon copy-icon--done" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" pathLength="1" />
    </svg>
  )
}

/**
 * The number inline in running text, set as a small code-style chip with a
 * copy icon; the icon turns into an animated tick once the copy goes through.
 * The "Хуулсан" status is for screen readers — sighted visitors get the tick.
 */
export function PhoneCopy({
  display = SHOP.phone,
  className = 'phone-copy',
}: {
  display?: string
  className?: string
}) {
  const { copied, copy, numberRef } = usePhoneCopy()

  return (
    <>
      <button
        type="button"
        className={className}
        data-copied={copied}
        onClick={copy}
        aria-label={`${display} — дугаар хуулах`}
      >
        <span ref={numberRef}>{display}</span>
        {copied ? <CopiedIcon /> : <CopyIcon />}
      </button>
      <span className="sr-only" role="status">
        {copied ? 'Хуулсан' : ''}
      </span>
    </>
  )
}
