import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

/**
 * Catalogue search.
 *
 * Types straight into the URL (`/products?q=...`) rather than holding results
 * in component state, so a search is shareable, survives a reload, and the
 * back button behaves. The listing route already loads from its search params.
 *
 * Debounced, and navigations while typing use `replace` so a five-letter query
 * does not leave five entries in history for the back button to walk through.
 */
const DEBOUNCE_MS = 250

export function SearchBox({
  autoFocus = false,
  placeholder = 'Бүтээгдэхүүн хайх',
}: {
  autoFocus?: boolean
  placeholder?: string
}) {
  /**
   * Reads the query from the URL rather than taking it as a prop.
   *
   * There are two of these on a desktop listing page — one in the header, one
   * above the grid. Passing `initial` down meant only the one that happened to
   * be given it showed the current search, so the header field sat empty while
   * results were plainly filtered. `strict: false` because this component also
   * renders on routes that have no `q` at all.
   */
  const search = useSearch({ strict: false }) as { q?: string }
  const initial = search.q ?? ''

  const [value, setValue] = useState(initial)
  const navigate = useNavigate()

  // Tracks what the URL already reflects, so the effect below can tell a user
  // keystroke apart from the URL changing underneath it (back button, a
  // category chip, landing on the page with ?q= already set).
  const settled = useRef(initial)

  useEffect(() => {
    setValue(initial)
    settled.current = initial
  }, [initial])

  useEffect(() => {
    if (value === settled.current) return

    const timer = setTimeout(() => {
      settled.current = value
      void navigate({
        to: '/products',
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          q: value.trim() || undefined,
        }),
        replace: true,
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [value, navigate])

  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        // Submitting just commits the pending debounce early; the effect owns
        // navigation either way.
        event.preventDefault()
        settled.current = value
        void navigate({
          to: '/products',
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            q: value.trim() || undefined,
          }),
          replace: true,
        })
      }}
    >
      <SearchIcon />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)}
        // enterKeyHint tells a phone keyboard to show "Search" not "Go".
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          className="search__clear"
          aria-label="Цэвэрлэх"
          onClick={() => setValue('')}
        >
          ×
        </button>
      )}
    </form>
  )
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m20 20-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
