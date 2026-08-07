import { useEffect, useRef } from 'react'

/**
 * The generative ASCII field behind the hero — matrix rain or a drifting star
 * field, depending on `engine`.
 *
 * Two things it deliberately does not do:
 *
 * It does not hold the grid in React state. At 12fps a state update per frame
 * would put React's reconciler on the animation's critical path for a picture
 * nothing else in the app reads; the loop writes `textContent` on one node it
 * owns and React never re-renders after mount.
 *
 * It does not run before mount. The field is generated, so there is nothing
 * meaningful to server-render — an SSR pass would emit one arbitrary frame that
 * the first client frame immediately replaces.
 */

export type FieldEngine = 'matrix' | 'stars'

/**
 * Density ramp, heaviest first. The colour comes from a gradient over the whole
 * layer, so a trail cannot fade by getting darker — it fades by getting
 * sparser, which is what this ramp is for.
 */
const RAMP = ['#', '%', '*', '+', '=', '-', ':', '.'] as const

/** A monospace character advances 0.6em; the grid maths depends on it. */
const ADVANCE = 0.6

/** Columns across. Fewer on a phone, or the glyphs are too small to have an
 *  inside and the field turns into grey noise. */
const columnsFor = (width: number) => (width < 700 ? 56 : 116)

const FRAME_MS = 1000 / 12

interface Drop {
  /** Head position in rows; fractional so speeds need not be integers. */
  y: number
  speed: number
  length: number
}

interface Star {
  x: number
  y: number
  /** Advances each frame; the glyph is a function of it, so stars twinkle out
   *  of phase with each other rather than pulsing in unison. */
  phase: number
  rate: number
}

/** Twinkle cycle. Ends on spaces so a star spends most of its life unlit. */
const TWINKLE = ['.', '+', '*', '+', '.', ' ', ' ', ' ', ' ', ' '] as const

export function HeroField({ engine = 'matrix' }: { engine?: FieldEngine }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const pre = preRef.current
    if (!host || !pre) return

    let cols = 0
    let rows = 0
    let drops: Drop[] = []
    let stars: Star[] = []

    const resetDrop = (): Drop => ({
      // Above the top edge, so a column starts by falling in rather than
      // popping into existence mid-screen.
      y: -Math.random() * rows,
      speed: 0.25 + Math.random() * 0.55,
      length: 6 + Math.floor(Math.random() * 14),
    })

    function measure() {
      const { width, height } = host!.getBoundingClientRect()
      if (width === 0 || height === 0) return

      cols = columnsFor(width)
      const size = width / (cols * ADVANCE)
      pre!.style.fontSize = `${size}px`

      // +1 so a partial bottom row is covered rather than showing the band.
      rows = Math.ceil(height / size) + 1

      drops = Array.from({ length: cols }, resetDrop)
      stars = Array.from(
        // One star per ~26 cells: sparse enough to read as a field rather
        // than as static.
        { length: Math.floor((cols * rows) / 26) },
        () => ({
          x: Math.floor(Math.random() * cols),
          y: Math.floor(Math.random() * rows),
          phase: Math.random() * TWINKLE.length,
          rate: 0.08 + Math.random() * 0.22,
        }),
      )
    }

    function paint() {
      if (cols === 0 || rows === 0) return

      const grid: string[][] = Array.from({ length: rows }, () =>
        new Array<string>(cols).fill(' '),
      )

      if (engine === 'matrix') {
        for (let c = 0; c < cols; c++) {
          const drop = drops[c]
          if (!drop) continue

          for (let i = 0; i < drop.length; i++) {
            const y = Math.floor(drop.y) - i
            if (y < 0 || y >= rows) continue

            // Position in the trail picks the glyph, so the head is solid and
            // the tail thins out to a full stop.
            const step = Math.floor((i / drop.length) * RAMP.length)
            const row = grid[y]
            if (row) row[c] = RAMP[Math.min(step, RAMP.length - 1)] ?? ' '
          }

          drop.y += drop.speed
          if (drop.y - drop.length > rows) drops[c] = resetDrop()
        }
      } else {
        for (const star of stars) {
          star.phase = (star.phase + star.rate) % TWINKLE.length
          const glyph = TWINKLE[Math.floor(star.phase)]
          const row = grid[star.y]
          if (row && glyph) row[star.x] = glyph
        }
      }

      pre!.textContent = grid.map((row) => row.join('')).join('\n')
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(host)

    // A generated background is ambient motion with no control over it, so
    // reduced motion gets a single frame and nothing further.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint()
      return () => observer.disconnect()
    }

    let raf = 0
    let last = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)

      // Throttled well under the display's rate: this is a background, and
      // repainting a few thousand glyphs 60 times a second to animate it would
      // cost more than everything else on the page put together.
      if (now - last < FRAME_MS) return
      last = now
      paint()
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [engine])

  return (
    <div className="hero__field" ref={hostRef} aria-hidden="true">
      <pre className="hero__field-grid" ref={preRef} />
    </div>
  )
}
