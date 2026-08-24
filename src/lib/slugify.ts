/** Mirrors the slug regex the server validates against, so a bad slug is
 * caught before submit rather than round-tripping to the server first. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
