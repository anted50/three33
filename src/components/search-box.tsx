import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { assert } from '~/lib/assert'
import { formatMnt } from '~/lib/money'
import { sizeSuffix } from '~/lib/product-name'
import {
  listProducts,
  type ProductCard,
} from '~/lib/server/products/queries'

/**
 * Catalogue search, as a dropdown of results under the field.
 *
 * Typing does not touch the page: matches load into a scrollable list that
 * opens beneath the input, the way a search engine shows suggestions, and
 * picking one goes straight to that product. Enter is the one way to search
 * the page itself: it opens /products?q=…, the full, shareable result list.
 *
 * Keyboard: ↓/↑ move through the results, Enter opens the highlighted one
 * (or the full list when none is), Escape closes the list.
 */
const DEBOUNCE_MS = 200

/**
 * Rows the dropdown lists. More is a wall to scroll on a phone, and the rest
 * are one tap away on the full list, whose button gives the whole count.
 */
const SEARCH_RESULTS_SHOWN_MAX = 8

/** The server's own cap (listProductsInput.q); longer input would be refused. */
const SEARCH_QUERY_LENGTH_MAX = 64

/**
 * Where the dropdown's request stands. `products` is the last answer that
 * came back, kept while the next one loads so the list does not blink empty
 * on every keystroke.
 */
interface ProductSearch {
  status: 'idle' | 'loading' | 'ready' | 'error'
  products: ProductCard[]
}

const SEARCH_IDLE: ProductSearch = { status: 'idle', products: [] }

export function SearchBox({
  placeholder = 'Бүтээгдэхүүн хайх',
}: {
  placeholder?: string
}) {
  // On /products?q=… the field shows the query the page was searched by.
  // `strict: false` because the box renders on routes with no `q` at all.
  const search = useSearch({ strict: false }) as { q?: string }
  const fromUrl = search.q ?? ''

  const [value, setValue] = useState(fromUrl)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const query = value.trim()
  const found = useProductSearch(query)
  const shown = found.products.slice(0, SEARCH_RESULTS_SHOWN_MAX)
  // Reset by the effect below, but a render runs before it does.
  const highlighted = active < shown.length ? active : -1
  const expanded = open && query !== ''

  useEffect(() => {
    setValue(fromUrl)
  }, [fromUrl])

  useEffect(() => {
    setActive(-1)
  }, [found.products])

  useCloseOnOutsidePointer({ open, rootRef, setOpen })

  const close = () => {
    setOpen(false)
    inputRef.current?.blur()
  }

  const showAll = () => {
    close()
    void navigate({ to: '/products', search: query ? { q: query } : {} })
  }

  const openProduct = (slug: string) => {
    close()
    void navigate({ to: '/products/$slug', params: { slug } })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    const count = shown.length
    if (!expanded || count === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index <= 0 ? count - 1 : index - 1))
    }
  }

  return (
    <div className="search-box" ref={rootRef}>
      <form
        className="search-box__field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          const picked = highlighted >= 0 ? shown[highlighted] : undefined
          if (picked) openProduct(picked.slug)
          else showAll()
        }}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={value}
          maxLength={SEARCH_QUERY_LENGTH_MAX}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlighted >= 0 ? `${listId}-${highlighted}` : undefined
          }
          autoComplete="off"
          // enterKeyHint tells a phone keyboard to show "Search" not "Go".
          enterKeyHint="search"
          onChange={(event) => {
            setValue(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            className="search__clear"
            aria-label="Цэвэрлэх"
            onClick={() => {
              setValue('')
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        )}
      </form>

      {expanded && (
        <SearchPanel
          query={query}
          found={found}
          shown={shown}
          highlighted={highlighted}
          listId={listId}
          onHighlight={setActive}
          onPick={close}
          onShowAll={showAll}
        />
      )}
    </div>
  )
}

/**
 * The dropdown under the field: a note while loading, on failure or when
 * nothing matches; otherwise the first SEARCH_RESULTS_SHOWN_MAX matches and a
 * button to the full list with the whole count.
 */
function SearchPanel({
  query,
  found,
  shown,
  highlighted,
  listId,
  onHighlight,
  onPick,
  onShowAll,
}: {
  query: string
  found: ProductSearch
  shown: ProductCard[]
  highlighted: number
  listId: string
  onHighlight: (index: number) => void
  onPick: () => void
  onShowAll: () => void
}) {
  assert(query !== '', 'the panel opens only for a typed query')
  assert(shown.length <= SEARCH_RESULTS_SHOWN_MAX, 'the panel lists a bounded slice')

  if (found.status === 'error') {
    return (
      <div className="search-box__panel">
        <p className="search-box__note">
          Хайлт амжилтгүй боллоо. Дахин оролдоно уу.
        </p>
      </div>
    )
  }

  if (shown.length === 0) {
    const waiting = found.status !== 'ready'
    return (
      <div className="search-box__panel">
        <p className="search-box__note">
          {waiting
            ? 'Хайж байна…'
            : `“${query}” хайлтад тохирох бүтээгдэхүүн олдсонгүй.`}
        </p>
      </div>
    )
  }

  return (
    <div className="search-box__panel">
      <ul className="search-box__list" id={listId} role="listbox">
        {shown.map((product, index) => (
          <li
            key={product.slug}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === highlighted}
          >
            <Link
              to="/products/$slug"
              params={{ slug: product.slug }}
              className="search-box__item"
              data-active={index === highlighted}
              tabIndex={-1}
              onClick={onPick}
              onPointerEnter={() => onHighlight(index)}
            >
              <span className="search-box__thumb">
                {product.imageUrl && (
                  <img src={product.imageUrl} alt="" loading="lazy" />
                )}
              </span>
              <span className="search-box__name">
                {product.name}
                {sizeSuffix(product.name, product.size)}
              </span>
              <span className="search-box__price">
                {product.totalStock > 0 ? formatMnt(product.fromPrice) : 'Дууссан'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className="search-box__all" onClick={onShowAll}>
        Бүх үр дүн ({found.products.length}) →
      </button>
    </div>
  )
}

/**
 * Matches for `query`, fetched DEBOUNCE_MS after the last keystroke.
 *
 * Every keystroke takes a new request number, so a slow answer to an earlier
 * query cannot land on top of a later one. A failed request is logged and
 * shown as an error, never as "nothing found", which would tell the shopper
 * the shop does not carry what it may well have.
 */
function useProductSearch(query: string): ProductSearch {
  const [found, setFound] = useState<ProductSearch>(SEARCH_IDLE)
  const requestRef = useRef(0)

  useEffect(() => {
    requestRef.current += 1
    const request = requestRef.current
    if (query === '') {
      setFound(SEARCH_IDLE)
      return
    }
    assert(query.length <= SEARCH_QUERY_LENGTH_MAX, 'the input caps the query')

    setFound((previous) => ({ status: 'loading', products: previous.products }))
    const timer = setTimeout(() => {
      listProducts({ data: { q: query } }).then(
        (products) => {
          if (request !== requestRef.current) return
          assert(Array.isArray(products), 'listProducts answers with a list')
          setFound({ status: 'ready', products })
        },
        (error: unknown) => {
          if (request !== requestRef.current) return
          console.error('Product search failed', error)
          setFound({ status: 'error', products: [] })
        },
      )
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  return found
}

/** Closes the dropdown when a tap or click lands anywhere outside the box. */
function useCloseOnOutsidePointer({
  open,
  rootRef,
  setOpen,
}: {
  open: boolean
  rootRef: RefObject<HTMLDivElement | null>
  setOpen: (open: boolean) => void
}) {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, rootRef, setOpen])
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
