/**
 * The Three 33 mark: two outlined circles around a solid one.
 *
 * Traced to SVG from ui/logo header light.png rather than shipping that file.
 * The mark is three circles, so the trace is exact, not an approximation — the
 * geometry below is measured off the source at its native 1404x475 and shifted
 * to a tight box (centres 166 / 531.5 / 897 on a 167 baseline, 18-unit stroke,
 * outlined radius 157.5 to put the stroke centreline where the source has it).
 *
 * Two reasons not to use the PNGs. They have an opaque background baked in —
 * #1b1b1b in the dark pair, white in the light pair — so each one only sits
 * correctly on the surface it was exported for, and neither works on the hero.
 * And stroke="currentColor" means one file inherits the colour of wherever it
 * is placed, which is what makes the dark/light pair unnecessary.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1064 334"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="166"
        cy="167"
        r="157.5"
        stroke="currentColor"
        strokeWidth="18"
      />
      <circle cx="531.5" cy="167" r="167" fill="currentColor" />
      <circle
        cx="897"
        cy="167"
        r="157.5"
        stroke="currentColor"
        strokeWidth="18"
      />
    </svg>
  )
}
