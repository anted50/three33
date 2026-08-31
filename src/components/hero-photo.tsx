/**
 * The homepage hero's photograph: the shop's "ROAD TO BARBER" board.
 *
 * Replaces HeroAscii on the band. That component and its art are kept in the
 * tree on purpose — the ASCII treatment is the fallback if the photograph ever
 * has to come down, and swapping back is a one-line change in routes/index.tsx
 * plus dropping `hero--photo` off the section.
 *
 * <img> rather than a CSS background so the browser gets a srcset to pick from:
 * the band is full-bleed, so on a phone it would otherwise pull the same 274KB
 * file a 1440px monitor does. fetchpriority high because this is the LCP
 * element on the site's most-visited page.
 *
 * aria-hidden with an empty alt: everything the picture says in words — the
 * shop's name — the h1 beside it already says, so describing it again would
 * only make the hero read twice.
 */
export function HeroPhoto() {
  return (
    <div className="hero__photo" aria-hidden="true">
      <img
        src="/hero-road-to-barber-1920.webp"
        srcSet="/hero-road-to-barber-760.webp 760w, /hero-road-to-barber-1200.webp 1200w, /hero-road-to-barber-1920.webp 1920w"
        sizes="100vw"
        width={1920}
        height={1440}
        alt=""
        decoding="async"
        fetchPriority="high"
      />
    </div>
  )
}
