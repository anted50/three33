import { useEffect, useRef, useState } from 'react'
import { ProductCard } from './product-card'
import type { ProductGroup } from '~/lib/server/products/queries'

/**
 * The default /products view: a left rail of categories, all of them
 * rendered on the right in one long scroll — tapping a category smooth-
 * scrolls to its section instead of reloading a filtered page. Matches the
 * left-nav menu pattern (rail on the left, grouped sections on the right,
 * the rail tracking scroll position) rather than the tab-filtered grid this
 * page used before.
 */
export function ProductGroups({ groups }: { groups: ProductGroup[] }) {
  const [active, setActive] = useState(groups[0]?.slug ?? '')
  const [headerHeight, setHeaderHeight] = useState(96)
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const clickScrolling = useRef(false)
  // Explicit `undefined` argument: React 19's types dropped the no-argument
  // useRef overload.
  const scrollSettleTimer = useRef<number | undefined>(undefined)

  // The sticky site header's height varies by breakpoint and by whether the
  // search panel is open, so it's measured rather than hardcoded — both the
  // rail's sticky offset and each section's scroll-margin depend on it.
  useEffect(() => {
    const header = document.querySelector('.header')
    if (!header) return

    const update = () => setHeaderHeight(header.getBoundingClientRect().height)
    update()

    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => window.clearTimeout(scrollSettleTimer.current), [])

  useEffect(() => {
    if (groups.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Ignore scroll-spy while a click-triggered scroll is still landing —
        // otherwise the rail flickers through every section it passes.
        if (clickScrolling.current) return

        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return

        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        )
        const slug = topmost.target.getAttribute('data-group-slug')
        if (slug) setActive(slug)
      },
      {
        // A thin band just under the sticky header — a section "arrives"
        // when its heading crosses that line, not whenever any sliver of it
        // is on screen.
        rootMargin: `-${headerHeight + 1}px 0px -70% 0px`,
        threshold: 0,
      },
    )

    for (const el of sectionRefs.current.values()) observer.observe(el)
    return () => observer.disconnect()
  }, [groups, headerHeight])

  function scrollToGroup(slug: string) {
    const el = sectionRefs.current.get(slug)
    if (!el) return

    setActive(slug)
    clickScrolling.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // scrollend isn't available everywhere yet; a timeout matched to the
    // smooth-scroll duration re-enables scroll-spy once the scroll settles.
    window.clearTimeout(scrollSettleTimer.current)
    scrollSettleTimer.current = window.setTimeout(() => {
      clickScrolling.current = false
    }, 600)
  }

  return (
    <div className="pgroups">
      <nav
        className="pgroups__rail"
        style={{ top: headerHeight, maxHeight: `calc(100vh - ${headerHeight}px)` }}
        aria-label="Ангилал"
      >
        {groups.map((group) => (
          <button
            key={group.slug}
            type="button"
            className="pgroups__railitem"
            data-active={group.slug === active}
            onClick={() => scrollToGroup(group.slug)}
          >
            {group.nameEn.toUpperCase()}
          </button>
        ))}
      </nav>

      <div className="pgroups__main">
        {groups.map((group) => (
          <section
            key={group.slug}
            ref={(el) => {
              if (el) sectionRefs.current.set(group.slug, el)
              else sectionRefs.current.delete(group.slug)
            }}
            data-group-slug={group.slug}
            style={{ scrollMarginTop: headerHeight + 12 }}
            className="pgroups__section"
          >
            <h2 className="pgroups__title">{group.nameMn}</h2>
            <div className="grid">
              {group.products.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
