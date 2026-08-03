/**
 * Dashboard charts, drawn as inline SVG.
 *
 * No charting library: these are four fixed shapes, and a chart package would
 * add more bundle weight than the whole admin section. Inline SVG also renders
 * server-side with the rest of the page — no post-hydration layout shift where
 * a card is empty and then suddenly isn't.
 *
 * All of them degrade to an empty frame rather than NaN paths when there is no
 * data yet, which for a shop that has not launched is the normal case.
 */

const ACCENT = 'var(--accent)'

/** Bar sparkline — daily revenue across the month. */
export function BarSpark({
  values,
  height = 64,
}: {
  values: number[]
  height?: number
}) {
  if (values.length === 0) return <ChartEmpty height={height} />

  const max = Math.max(...values, 1)
  const gap = 2
  const width = 100
  const barWidth = Math.max((width - gap * (values.length - 1)) / values.length, 1)

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label={`Өдрийн борлуулалт, ${values.length} хоног`}
    >
      {values.map((value, index) => {
        // Always show a sliver for a zero day, so gaps read as "no sales"
        // rather than as missing data.
        const barHeight = Math.max((value / max) * height, value > 0 ? 2 : 1)
        return (
          <rect
            key={index}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            fill={ACCENT}
            opacity={value > 0 ? 1 : 0.18}
            rx={0.6}
          />
        )
      })}
    </svg>
  )
}

/** Line sparkline — distinct customers per day. */
export function LineSpark({
  values,
  height = 64,
}: {
  values: number[]
  height?: number
}) {
  if (values.length === 0) return <ChartEmpty height={height} />

  const width = 100
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : width

  const points = values.map((value, index) => {
    const x = index * step
    // 2px inset top and bottom so the stroke is not clipped by the viewBox.
    const y = height - 2 - (value / max) * (height - 4)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  // A single data point has no line to draw, so give it a flat segment.
  const d =
    values.length === 1
      ? `M0,${height / 2} L${width},${height / 2}`
      : `M${points.join(' L')}`

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label={`Өдрийн хэрэглэгч, ${values.length} хоног`}
    >
      <path
        d={d}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Progress toward the monthly order goal. */
export function GoalBar({ value, goal }: { value: number; goal: number }) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0

  return (
    <div
      className="goal"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={goal}
    >
      <div className="goal__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export interface DonutSlice {
  label: string
  value: number
}

/**
 * Donut of best-selling share. Drawn with stroke-dasharray on a circle rather
 * than arc paths — far less trigonometry to get wrong, and it animates cleanly
 * if we ever want it to.
 */
export function Donut({
  slices,
  size = 116,
}: {
  slices: DonutSlice[]
  size?: number
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)

  if (total <= 0) {
    return (
      <svg className="donut" viewBox="0 0 42 42" style={{ width: size, height: size }} role="img" aria-label="Мэдээлэл алга">
        <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--border)" strokeWidth="5" />
      </svg>
    )
  }

  // Circumference of r=15.9 is ~100, so each slice's dash length is its percent.
  const CIRCUMFERENCE = 100
  let offset = 25 // start at 12 o'clock

  return (
    <svg
      className="donut"
      viewBox="0 0 42 42"
      style={{ width: size, height: size }}
      role="img"
      aria-label="Шилдэг борлуулалтын хувь"
    >
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--border)" strokeWidth="5" />
      {slices.map((slice, index) => {
        const pct = (slice.value / total) * CIRCUMFERENCE
        const dash = `${pct} ${CIRCUMFERENCE - pct}`
        const el = (
          <circle
            key={slice.label}
            cx="21"
            cy="21"
            r="15.9"
            fill="none"
            stroke={ACCENT}
            strokeWidth="5"
            strokeDasharray={dash}
            strokeDashoffset={offset}
            // Lighten each successive slice so they stay distinguishable
            // without introducing colours outside the palette.
            opacity={1 - index * 0.22}
          />
        )
        offset -= pct
        return el
      })}
    </svg>
  )
}

function ChartEmpty({ height }: { height: number }) {
  return <div className="spark spark--empty" style={{ height }} />
}
