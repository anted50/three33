import { describe, expect, it } from 'vitest'
import { clientIp } from './client-ip'

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null

describe('clientIp', () => {
  it('trusts CF-Connecting-IP over a client-supplied X-Forwarded-For', () => {
    expect(clientIp(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('falls back to the first X-Forwarded-For entry (local dev)', () => {
    expect(clientIp(headers({ 'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2' }))).toBe('10.0.0.1')
  })

  it('is null when neither header is there', () => {
    expect(clientIp(headers({}))).toBeNull()
  })
})
