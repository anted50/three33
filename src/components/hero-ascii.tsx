import { useEffect, useState } from 'react'
import art from '~/assets/hero-ascii.txt?raw'

/**
 * The ASCII barber scene behind the homepage hero.
 *
 * Its own module, not an import inside routes/index.tsx, because TanStack
 * Start code-splits route files: it lifts `component` into a separate client
 * chunk, and the `?raw` import did not travel with it. The route still
 * server-rendered correctly and then blew up at hydration with
 * "heroAscii is not defined" — a plain component module is not split, so the
 * import stays attached to the code that uses it.
 *
 * aria-hidden: 75 lines of '#' is thousands of punctuation characters to a
 * screen reader and says nothing the h1 beside it does not.
 */

const SOURCE_LINES = art.split('\n')

/**
 * The only glyphs the shimmer may touch, and the only ones it may substitute.
 *
 * Deliberately excludes '#'. The art is 1524 '#' against 271 of these, so the
 * hashes are its solid mass — swapping one punches a visible hole that reads as
 * a rendering fault. These three are the sparse cells along edges and in the
 * shading, where a change of density reads as the picture breathing.
 */
const SHIMMER_GLYPHS = ['.', '-', '+'] as const

/** Every [row, column] holding a shimmer glyph. Scanned once, at module load. */
const CELLS: Array<[number, number]> = SOURCE_LINES.flatMap((line, y) =>
  [...line].flatMap((char, x): Array<[number, number]> =>
    (SHIMMER_GLYPHS as readonly string[]).includes(char) ? [[y, x]] : [],
  ),
)

/**
 * Slow on purpose. Each tick rewrites the whole 13KB text node and the browser
 * re-lays out 13,500 glyphs; at this rate that is a few milliseconds a second
 * and never lands near a frame budget. It is also the rate that reads as
 * ambient rather than as flicker.
 */
const TICK_MS = 1200
const CELLS_PER_TICK = 6

function swap(line: string, x: number): string {
  const current = line[x]
  if (current === undefined) return line

  // Any glyph but the one already there, so every pick is a visible change.
  const options = SHIMMER_GLYPHS.filter((g) => g !== current)
  const next = options[Math.floor(Math.random() * options.length)]
  if (next === undefined) return line

  return line.slice(0, x) + next + line.slice(x + 1)
}

export function HeroAscii() {
  const [lines, setLines] = useState(SOURCE_LINES)

  useEffect(() => {
    // Ambient motion with no user control, so it is exactly what this query is
    // for. Checked at run time rather than in CSS because the animation is the
    // content changing, not a property being animated.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches || CELLS.length === 0) return

    const id = setInterval(() => {
      setLines((previous) => {
        const next = [...previous]

        for (let i = 0; i < CELLS_PER_TICK; i++) {
          const cell = CELLS[Math.floor(Math.random() * CELLS.length)]
          if (cell === undefined) continue

          const [y, x] = cell
          const line = next[y]
          if (line === undefined) continue

          next[y] = swap(line, x)
        }

        return next
      })
    }, TICK_MS)

    return () => clearInterval(id)
  }, [])

  return (
    <div className="hero__art" aria-hidden="true">
      <pre className="hero__ascii">{lines.join('\n')}</pre>
    </div>
  )
}
