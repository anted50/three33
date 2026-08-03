import { describe, expect, it } from 'vitest'
import { resolveExpiry, sanitizeDescription } from './client'

describe('resolveExpiry', () => {
  const now = 1_700_000_000_000 // epoch ms

  it('treats a large value as an epoch-second timestamp', () => {
    // QPay's documented behaviour: expires_in is the moment the token dies.
    const expiresAt = resolveExpiry(1_700_000_600, now)
    // 600s out, less the 60s safety margin.
    expect(expiresAt).toBe(1_700_000_540_000)
  })

  it('treats a small value as a duration in seconds', () => {
    // Defensive: the OAuth-style field name invites this reading, and QPay
    // could switch to it without telling anyone.
    expect(resolveExpiry(3600, now)).toBe(now + 3_600_000 - 60_000)
  })

  it('never returns a time in the past, which would spin the refresh loop', () => {
    // An already-expired timestamp.
    expect(resolveExpiry(1_600_000_000, now)).toBeGreaterThan(now)
  })

  it('never returns a time in the past for a tiny duration either', () => {
    expect(resolveExpiry(5, now)).toBeGreaterThan(now)
  })
})

describe('sanitizeDescription', () => {
  it('keeps Cyrillic, latin, digits, spaces and hyphens', () => {
    expect(sanitizeDescription('Захиалга UD-1001')).toBe('Захиалга UD-1001')
  })

  it('strips characters QPay rejects', () => {
    expect(sanitizeDescription('Order #1311 / 200.00 @shop!')).toBe(
      'Order 1311 200.00 shop',
    )
  })

  it('collapses the whitespace stripping leaves behind', () => {
    expect(sanitizeDescription('a###b')).toBe('a b')
  })

  it('falls back rather than sending an empty description', () => {
    expect(sanitizeDescription('###')).toBe('Захиалга')
    expect(sanitizeDescription('')).toBe('Захиалга')
  })

  it('truncates to the 255-character field limit', () => {
    expect(sanitizeDescription('a'.repeat(400))).toHaveLength(255)
  })
})
