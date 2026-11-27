import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { assert } from '~/lib/assert'

/** Where the visible part of a row sits in it, as fractions of its full width. */
interface Thumb {
  start: number
  size: number
}

/**
 * A scrollbar that is always there, drawn under a row that scrolls sideways.
 *
 * Phones hide native scrollbars until a finger is already moving, so a row
 * cut off at the screen's edge gave no sign there was more. This draws the
 * row's bottom rule as a track, with a dark thumb sized to the visible share
 * and moved as the row scrolls. When everything fits there is no thumb, and
 * the track is just the rule.
 *
 * Decorative only (aria-hidden): the row itself stays the scrolling element,
 * so touch, keyboard and screen readers work on it as before.
 */
export function ScrollTrack({
  target,
  className,
}: {
  target: RefObject<HTMLElement | null>
  className?: string
}) {
  const [thumb, setThumb] = useState<Thumb | null>(null)

  useEffect(() => {
    const row = target.current
    if (!row) return

    // One measurement per frame at most, however fast scroll events come.
    let frame = 0
    const measure = () => {
      frame = 0
      setThumb(thumbFor(row))
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }

    measure()
    row.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(row)

    return () => {
      row.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [target])

  return (
    <div
      className={className ? `scrolltrack ${className}` : 'scrolltrack'}
      aria-hidden
    >
      {thumb && (
        <span
          className="scrolltrack__thumb"
          style={{
            left: `${thumb.start * 100}%`,
            width: `${thumb.size * 100}%`,
          }}
        />
      )}
    </div>
  )
}

/** The thumb for a row's current scroll, or null when the row fits. */
function thumbFor(row: HTMLElement): Thumb | null {
  const { scrollLeft, scrollWidth, clientWidth } = row
  // A pixel of slack: sub-pixel layouts report a scrollWidth one over.
  if (scrollWidth <= clientWidth + 1) return null

  const size = clientWidth / scrollWidth
  const start = Math.min(Math.max(scrollLeft / scrollWidth, 0), 1 - size)
  assert(size > 0, 'an overflowing row shows some of itself')
  assert(size < 1, 'an overflowing row hides some of itself')
  return { start, size }
}
