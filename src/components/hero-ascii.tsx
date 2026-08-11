import { useEffect, useRef } from 'react'
import art from '~/assets/hero-ascii.txt?raw'
import {
  buildFill,
  edgeTones,
  isRampChar,
  neighbour,
  seededRandom,
} from '~/lib/ascii-art'

/**
 * The ASCII barber scene behind the homepage hero, with a phosphor flicker
 * over it.
 *
 * Its own module, not an import inside routes/index.tsx, because TanStack
 * Start code-splits route files: it lifts `component` into a separate client
 * chunk, and the `?raw` import did not travel with it. The route still
 * server-rendered correctly and then blew up at hydration with
 * "heroAscii is not defined" — a plain component module is not split, so the
 * import stays attached to the code that uses it.
 *
 * aria-hidden: 100 lines of dense punctuation is thousands of characters to a
 * screen reader and says nothing the h1 beside it does not.
 */

const SOURCE_LINES = art.split('\n')

const ART_COLS = Math.max(...SOURCE_LINES.map((line) => line.length))

/** Tone of the picture's left edge, per row. Computed once, at module load. */
const EDGE_TONES = edgeTones(SOURCE_LINES)

/**
 * ~12 changes a second across about 1% of the flickerable cells each time. Fast
 * enough to read as a live surface rather than as occasional glitches — the
 * previous 4-cells-per-1.6s was slow enough that you had to be looking for it.
 *
 * 1% and not the old 2% because a ramp step is a subtler change than a glyph
 * swap was, but there are now four times as many cells eligible for it; at 2%
 * the whole picture crawled.
 */
const TICK_MS = 80
const FLICKER_SHARE = 0.01

/**
 * Fixed, so a given band width always generates the same fill and a resize does
 * not reshuffle the left half of the hero.
 */
const FILL_SEED = 0x33be

/** Below this the fill is narrower than the jitter, and reads as dirt. */
const MIN_FILL_COLS = 8

export function HeroAscii() {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const pre = preRef.current
    const host = pre?.parentElement
    if (!pre || !host) return

    /*
     * The picture is fitted to the band by height so that none of it is cropped
     * away, which leaves the band wider than the picture at every size above a
     * phone. This fills that remainder with generated characters drawn from the
     * same ramp, continuing the tone of the picture's own left edge.
     *
     * Generated here rather than shipped in the .txt because how many columns
     * are needed is a function of the viewport: a fixed number wide enough for
     * an ultrawide monitor would be some 50KB of characters, nearly all of them
     * cropped away or masked to nothing on the screens most people are on.
     *
     * Measured, not derived from a 0.6em advance: the glyph width that matters
     * is the one the browser actually used, and reading it off the rendered art
     * costs one layout and cannot drift from the font.
     */
    let lines = [...SOURCE_LINES]
    let fillCols = -1

    /*
     * False whenever the band is display:none, which is how the art is kept off
     * phones. Tracked here rather than re-measured in the animation, so the tick
     * below costs nothing at all on the sizes that never show the art — and so
     * it starts on its own if the viewport is widened past the breakpoint,
     * because the observer fires when the box comes back.
     */
    let visible = false

    const layout = () => {
      /*
       * Divided by what the <pre> currently holds, not by the art's own width.
       * Once a fill has been added the element is the art plus the fill wide,
       * and measuring it as if it were still just the art reads the glyph half
       * again too large — which computes a fill of zero columns, wipes the one
       * that is there, and makes the next pass measure correctly again. The
       * band flickered between filled and bare at observer rate.
       */
      const drawn = ART_COLS + Math.max(0, fillCols)
      const glyph = pre.getBoundingClientRect().width / drawn
      visible = glyph > 0
      if (!visible) return

      const next = Math.max(
        0,
        Math.ceil((host.clientWidth - ART_COLS * glyph) / glyph),
      )
      const cols = next < MIN_FILL_COLS ? 0 : next
      if (cols === fillCols) return

      fillCols = cols
      const fill = buildFill(EDGE_TONES, cols, seededRandom(FILL_SEED))
      lines = SOURCE_LINES.map((line, y) => (fill[y] ?? '') + line)
      pre.textContent = lines.join('\n')
    }

    layout()

    // The fill is sized to the band, so it has to be rebuilt when the band
    // changes width. Cheap because layout() returns early unless the column
    // count actually moved, which for a drag-resize is most frames.
    const observer = new ResizeObserver(layout)
    observer.observe(host)

    // Ambient motion with no user control, so it is exactly what this query is
    // for. Checked at run time rather than in CSS because the animation is the
    // content changing, not a property being animated.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return () => observer.disconnect()
    }

    const id = setInterval(() => {
      if (!visible) return

      const rows = lines.length
      const cols = fillCols + ART_COLS
      const budget = Math.round(rows * cols * FLICKER_SHARE)

      for (let i = 0; i < budget; i++) {
        const y = Math.floor(Math.random() * rows)
        const line = lines[y]
        if (line === undefined) continue

        const x = Math.floor(Math.random() * line.length)
        const current = line[x]
        // Spaces are the bare paper around the figure; lighting one up puts a
        // glyph where the picture has nothing.
        if (current === undefined || current === ' ' || !isRampChar(current)) {
          continue
        }

        const next = neighbour(current, Math.random)
        if (next === undefined || next === current) continue

        // Mutated in place and written straight to the node. Holding this in
        // React state would put the reconciler on the critical path of an
        // animation whose output nothing else in the app reads.
        lines[y] = line.slice(0, x) + next + line.slice(x + 1)
      }

      pre.textContent = lines.join('\n')
    }, TICK_MS)

    return () => {
      observer.disconnect()
      clearInterval(id)
    }
  }, [])

  return (
    <div className="hero__art" aria-hidden="true">
      <pre className="hero__ascii" ref={preRef}>
        {art}
      </pre>
    </div>
  )
}
