import { qpayErrorResponse, qpayTokenResponse } from './types'

export class QpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'QpayError'
  }
}

export interface QpayClientConfig {
  baseUrl: string
  username: string
  password: string
  /** Request timeout. QPay is usually fast; a hung call blocks a checkout. */
  timeoutMs?: number
}

interface CachedToken {
  accessToken: string
  /** Epoch ms at which we stop trusting it. */
  expiresAtMs: number
}

/**
 * Thin QPay HTTP client. Its one real job beyond `fetch` is token discipline:
 *
 * QPay's integration notes are explicit that the token must be fetched once per
 * validity window, not per request — repeatedly hitting /auth/token gets a
 * merchant throttled. So the token is cached, and concurrent callers share a
 * single in-flight refresh rather than each starting their own.
 */
export class QpayClient {
  private token: CachedToken | null = null
  private inFlight: Promise<CachedToken> | null = null
  private readonly timeoutMs: number

  constructor(private readonly config: QpayClientConfig) {
    this.timeoutMs = config.timeoutMs ?? 15_000
  }

  async request<T>(
    path: string,
    init: { method: string; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    const token = await this.getToken()

    const response = await this.fetchWithTimeout(this.url(path), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    // A 401 usually means the cached token died earlier than advertised
    // (QPay can invalidate on its side). Drop it and retry exactly once;
    // retrying further would just hammer /auth/token.
    if (response.status === 401) {
      this.token = null
      const fresh = await this.getToken()
      const retry = await this.fetchWithTimeout(this.url(path), {
        method: init.method,
        headers: {
          Authorization: `Bearer ${fresh.accessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      })
      return this.parse<T>(retry, path)
    }

    return this.parse<T>(response, path)
  }

  /** Exposed so tests and the reconcile script can force a fresh token. */
  clearToken(): void {
    this.token = null
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`
  }

  private async parse<T>(response: Response, path: string): Promise<T> {
    const text = await response.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      throw new QpayError(
        `QPay ${path} returned non-JSON (${response.status})`,
        response.status,
        undefined,
        text.slice(0, 500),
      )
    }

    if (!response.ok) {
      const parsed = qpayErrorResponse.safeParse(body)
      const code = parsed.success ? (parsed.data.error ?? undefined) : undefined
      const message = parsed.success ? parsed.data.message : undefined
      throw new QpayError(
        `QPay ${path} failed: ${code ?? response.status}${
          message ? ` (${message})` : ''
        }`,
        response.status,
        code,
        body,
      )
    }

    return body as T
  }

  private async getToken(): Promise<CachedToken> {
    if (this.token && Date.now() < this.token.expiresAtMs) {
      return this.token
    }

    // Single-flight: if a refresh is already running, wait for it instead of
    // starting a second one. Without this, a burst of checkouts arriving on a
    // cold cache would each fire their own /auth/token call.
    if (this.inFlight) return this.inFlight

    this.inFlight = this.fetchToken()
      .then((token) => {
        this.token = token
        return token
      })
      .finally(() => {
        this.inFlight = null
      })

    return this.inFlight
  }

  private async fetchToken(): Promise<CachedToken> {
    const basic = Buffer.from(
      `${this.config.username}:${this.config.password}`,
    ).toString('base64')

    const response = await this.fetchWithTimeout(this.url('/auth/token'), {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    })

    const body = await this.parse<unknown>(response, '/auth/token')
    const parsed = qpayTokenResponse.safeParse(body)
    if (!parsed.success) {
      throw new QpayError(
        `QPay /auth/token returned an unrecognised shape: ${parsed.error.message}`,
        response.status,
        'TOKEN_PARSE_ERROR',
        body,
      )
    }

    return {
      accessToken: parsed.data.access_token,
      expiresAtMs: resolveExpiry(parsed.data.expires_in),
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new QpayError(`QPay request timed out after ${this.timeoutMs}ms`, 504)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * QPay rejects invoice descriptions containing special characters. Cyrillic is
 * fine; punctuation beyond spaces, hyphens and dots is not worth the risk of a
 * failed checkout, so it is stripped rather than escaped.
 *
 * Lives here rather than beside the provider so it stays testable without
 * pulling in the validated environment.
 */
export function sanitizeDescription(description: string): string {
  return (
    description
      .replace(/[^\p{L}\p{N} \-.]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 255) || 'Захиалга'
  )
}

/** Renew this long before the token actually dies. */
const SAFETY_MARGIN_MS = 60_000

/**
 * QPay's `expires_in` is documented as, and observed to be, a UNIX timestamp in
 * seconds — not a duration, despite the OAuth-style name. Treating it as a
 * duration produces a token we believe is good for decades and never refresh,
 * which then fails in production the first time QPay rotates it.
 *
 * Both readings are handled because the field name invites the other one, and
 * a wrong guess here is a silent outage rather than a loud error.
 */
export function resolveExpiry(expiresIn: number, now = Date.now()): number {
  // Anything above this is far too large to be a sane "seconds from now" value
  // (~31 years) and far too small to be anything but an epoch second count.
  const TIMESTAMP_THRESHOLD_SECONDS = 1_000_000_000

  const expiresAtMs =
    expiresIn > TIMESTAMP_THRESHOLD_SECONDS
      ? expiresIn * 1000 // epoch seconds
      : now + expiresIn * 1000 // duration in seconds

  // Never return a time in the past; that would spin the refresh loop.
  return Math.max(expiresAtMs - SAFETY_MARGIN_MS, now + 30_000)
}
