import { useState } from 'react'

export interface ImageEntry {
  url: string
  alt: string
}

/** Mirrors the server's rule: an absolute http(s) URL, or a site-relative
 * path for the packshots served from public/. */
const IMAGE_URL = /^(https?:\/\/|\/)\S*$/i

interface ImageUrlEditorProps {
  images: ImageEntry[]
  onChange: (images: ImageEntry[]) => void
}

/**
 * Product images by URL — they live on the supplier's CDN (Shopify today), so
 * the shop pastes a link rather than uploading a file. The preview is the
 * whole point: a typo'd or hotlink-blocked URL is invisible until something
 * tries to render it, and better here than on the storefront.
 */
export function ImageUrlEditor({ images, onChange }: ImageUrlEditorProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    const url = draft.trim()
    if (url === '') return

    if (!IMAGE_URL.test(url)) {
      setError('Зургийн хаяг http://, https:// эсвэл / -ээр эхлэх ёстой')
      return
    }
    if (images.some((i) => i.url === url)) {
      setError('Энэ зураг аль хэдийн нэмэгдсэн байна')
      return
    }

    onChange([...images, { url, alt: '' }])
    setDraft('')
    setError(null)
  }

  return (
    <div className="imgs">
      <label className="field">
        <span>Зургийн холбоос</span>
        <div className="imgs__add">
          <input
            value={draft}
            placeholder="https://cdn.shopify.com/…/pomade.jpg"
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              // The editor lives inside the product <form>; Enter here must add
              // an image, not submit the product.
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button type="button" className="btn btn--sm" onClick={add}>
            Нэмэх
          </button>
        </div>
        <small>Эхний зураг нь үндсэн зураг болно</small>
      </label>

      {error && <p className="error">{error}</p>}

      {images.length > 0 && (
        <ul className="imgs__list">
          {images.map((image, i) => (
            <li key={image.url} className="imgs__item">
              <img src={image.url} alt="" className="imgs__thumb" />
              <div className="imgs__meta">
                <p className="adm__mono adm__muted">{image.url}</p>
                <input
                  value={image.alt}
                  placeholder="Alt текст (заавал биш)"
                  onChange={(e) =>
                    onChange(
                      images.map((other, j) =>
                        j === i ? { ...other, alt: e.target.value } : other,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => onChange(images.filter((_, j) => j !== i))}
              >
                Хасах
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
