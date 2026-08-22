import { useEffect, useRef } from 'react'
import art from '~/assets/hero-ascii.txt?raw'
import {
  buildFill,
  buildRowFill,
  edgeTones,
  edgeTonesRow,
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

// hero-ascii.txt ends with a trailing newline, so a bare split('\n') would
// carry a phantom 101st line (empty string). Harmless as long as nothing
// counts rows — EDGE_TONES tolerated it as one more all-blank row to
// average in — but buildRowFill below sizes its fill off ART_ROWS exactly,
// so an inflated count overflows the band by one glyph's worth every time.
const SOURCE_LINES = art.replace(/\n$/, '').split('\n')

const ART_COLS = Math.max(...SOURCE_LINES.map((line) => line.length))
const ART_ROWS = SOURCE_LINES.length

/** Tone of the picture's left edge, per row — feeds the desktop/tablet fill,
 * which grows leftward from the picture. */
const EDGE_TONES = edgeTones(SOURCE_LINES)

/** Tone of the picture's top and bottom edges, per column — feeds the phone
 * fill, which grows upward and downward from the picture instead. */
const EDGE_TONES_TOP = edgeTonesRow(SOURCE_LINES, 'top')
const EDGE_TONES_BOTTOM = edgeTonesRow(SOURCE_LINES, 'bottom')

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
 * Fixed, so a given band size always generates the same fill and a resize
 * does not reshuffle it.
 */
const FILL_SEED = 0x33be

/** Below this the fill is narrower than the jitter, and reads as dirt. */
const MIN_FILL_COLS = 8

/** Same idea, vertically — see MIN_FILL_COLS. Rows read as intentional sooner
 * than columns do, because each one carries a full line's worth of jitter. */
const MIN_FILL_ROWS = 3

/** Must match the max-width this component's own breakpoint uses in
 * app.css — that CSS switches .hero__ascii from fitting by height (cqb) to
 * fitting by width (cqi), and this has to know which mode it is filling for. */
const MOBILE_QUERY = '(max-width: 699px)'

export function HeroAscii() {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const pre = preRef.current
    const host = pre?.parentElement
    if (!pre || !host) return

    /*
     * Above a phone, the picture is fitted to the band by height, which
     * leaves the band wider than the picture — filled sideways, see
     * buildFill. On a phone it is fitted by width instead (app.css), which
     * leaves it shorter than the band — filled up and down instead, see
     * buildRowFill. Both exist because the alternative was cropping the
     * photograph to cover the remainder, which is worse than more of the
     * same generated texture around it.
     *
     * Generated here rather than shipped in the .txt because how much is
     * needed is a function of the viewport in both directions: a fixed amount
     * wide/tall enough for the largest screen would be mostly cropped away or
     * masked to nothing on the screens most people are on.
     *
     * Measured, not derived from a 0.6em advance: the glyph size that matters
     * is the one the browser actually used, and reading it off the rendered
     * art costs one layout and cannot drift from the font.
     */
    let lines = [...SOURCE_LINES]
    let fillCols = -1
    let fillRows = -1

    /*
     * False whenever the band is display:none. Tracked here rather than
     * re-measured in the animation, so the tick below costs nothing at all on
     * sizes that never show the art — and so it starts on its own if the
     * viewport moves back into a size that shows it, because the observer
     * fires when the box comes back.
     */
    let visible = false

    const layoutSideways = () => {
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

    const layoutUpDown = () => {
      // Same idea as layoutSideways, on the other axis: measure against what
      // is currently drawn, not the art's own height, or the same
      // fills/wipes/refills flicker happens at observer rate.
      const drawn = ART_ROWS + Math.max(0, fillRows)
      const glyph = pre.getBoundingClientRect().height / drawn
      visible = glyph > 0
      if (!visible) return

      const next = Math.max(
        0,
        Math.ceil((host.clientHeight - ART_ROWS * glyph) / glyph),
      )
      const rows = next < MIN_FILL_ROWS ? 0 : next
      if (rows === fillRows) return

      fillRows = rows
      const top = Math.floor(rows / 2)
      const bottom = rows - top
      const topFill = buildRowFill(
        EDGE_TONES_TOP,
        top,
        seededRandom(FILL_SEED),
      )
      const bottomFill = buildRowFill(
        EDGE_TONES_BOTTOM,
        bottom,
        seededRandom(FILL_SEED + 1),
      ).reverse()
      lines = [...topFill, ...SOURCE_LINES, ...bottomFill]
      pre.textContent = lines.join('\n')
    }

    // Which axis was filled last time layout() ran. Crossing the breakpoint
    // switches which of fillCols/fillRows layoutSideways/layoutUpDown checks
    // against, but the one it stops checking still holds its last value —
    // without this, resizing back across the breakpoint to a size that
    // happens to need the same fill count as before crossing it would read as
    // "unchanged" and skip the rewrite, leaving the other axis's content on
    // screen.
    let mode: 'sideways' | 'up-down' | null = null

    const layout = () => {
      const nextMode = window.matchMedia(MOBILE_QUERY).matches
        ? 'up-down'
        : 'sideways'

      if (nextMode !== mode) {
        mode = nextMode
        fillCols = -1
        fillRows = -1
      }

      if (mode === 'up-down') {
        layoutUpDown()
      } else {
        layoutSideways()
      }
    }

    layout()

    // The fill is sized to the band, so it has to be rebuilt when the band
    // changes size, in whichever dimension is live at the current breakpoint.
    // Cheap because layout() returns early unless the fill actually moved,
    // which for a drag-resize is most frames.
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

      // Total cells currently on screen, whichever axis is filled — simpler
      // and just as correct as tracking fillCols/fillRows separately here,
      // since every row's own length already reflects whichever fill mode
      // (or neither) is active.
      const budget = Math.round(
        lines.reduce((sum, line) => sum + line.length, 0) * FLICKER_SHARE,
      )

      for (let i = 0; i < budget; i++) {
        const y = Math.floor(Math.random() * lines.length)
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
