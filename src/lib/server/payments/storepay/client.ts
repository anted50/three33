import { storepayTokenResponse } from './types'

export class StorepayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'StorepayError'
  }
}

export interface StorepayClientConfig {
  /** e.g. https://service.storepay.mn/lend-merchant — no trailing slash needed. */
  baseUrl: string
  /** Client (app) credentials, sent as HTTP Basic on /oauth/token. */
  appUsername: string
  appPassword: string
  /** Resource-owner credentials StorePay issued this merchant. */
  username: string
  password: string
  timeoutMs?: number
}

interface CachedToken {
  accessToken: string
  /** Epoch ms at which we stop trusting it. */
  expiresAtMs: number
}

/** Renew this long before the token actually dies. */
const SAFETY_MARGIN_MS = 60_000

/**
 * Thin StorePay HTTP client. Same token-discipline reasoning as QpayClient —
 * fetch once per validity window, cache it, and share one in-flight refresh
 * across concurrent callers rather than hammering /oauth/token.
 *
 * The one shape difference from QPay: every StorePay endpoint answers with
 * HTTP 200 and puts success/failure in the body's `status` field, so a 200
 * response is not by itself proof the call did what it asked. `request` below
 * treats `status: "Failed"` the same as a non-2xx: it throws.
 */
export class StorepayClient {
  private token: CachedToken | null = null
  private inFlight: Promise<CachedToken> | null = null
  private readonly timeoutMs: number
  /** The oauth host lives under the domain's root, not under baseUrl's
   * /lend-merchant path — derived once so config only needs one URL. */
  private readonly authOrigin: string

  constructor(private readonly config: StorepayClientConfig) {
    this.timeoutMs = config.timeoutMs ?? 15_000
    this.authOrigin = new URL(config.baseUrl).origin
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

    // A 401 usually means the cached token died earlier than advertised.
    // Drop it and retry exactly once; retrying further would just hammer
    // /oauth/token.
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

  /** Exposed so tests can force a fresh token. */
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
      throw new StorepayError(
        `StorePay ${path} returned non-JSON (${response.status})`,
        response.status,
        text.slice(0, 500),
      )
    }

    if (!response.ok) {
      throw new StorepayError(
        `StorePay ${path} failed (${response.status})`,
        response.status,
        body,
      )
    }

    if (isFailedEnvelope(body)) {
      const message = body.msgList
        .map((m) => m.text ?? m.code)
        .filter(Boolean)
        .join('; ')
      throw new StorepayError(
        `StorePay ${path} reported failure${message ? `: ${message}` : ''}`,
        response.status,
        body,
      )
    }

    return body as T
  }

  private async getToken(): Promise<CachedToken> {
    if (this.token && Date.now() < this.token.expiresAtMs) {
      return this.token
    }

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
      `${this.config.appUsername}:${this.config.appPassword}`,
    ).toString('base64')

    const tokenUrl = new URL(`${this.authOrigin}/merchant-uaa/oauth/token`)
    tokenUrl.searchParams.set('grant_type', 'password')
    tokenUrl.searchParams.set('username', this.config.username)
    tokenUrl.searchParams.set('password', this.config.password)

    const response = await this.fetchWithTimeout(tokenUrl.toString(), {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    })

    const text = await response.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      throw new StorepayError(
        `StorePay /oauth/token returned non-JSON (${response.status})`,
        response.status,
        text.slice(0, 500),
      )
    }

    if (!response.ok) {
      throw new StorepayError(
        `StorePay /oauth/token failed (${response.status})`,
        response.status,
        body,
      )
    }

    const parsed = storepayTokenResponse.safeParse(body)
    if (!parsed.success) {
      throw new StorepayError(
        `StorePay /oauth/token returned an unrecognised shape: ${parsed.error.message}`,
        response.status,
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
        throw new StorepayError(
          `StorePay request timed out after ${this.timeoutMs}ms`,
          504,
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * StorePay's `expires_in` is a plain duration in seconds — unlike QPay's,
 * which is documented and observed to be a UNIX timestamp despite the name.
 * No dual-interpretation guard needed here, just the same safety margin and
 * never-in-the-past floor.
 */
export function resolveExpiry(expiresIn: number, now = Date.now()): number {
  return Math.max(now + expiresIn * 1000 - SAFETY_MARGIN_MS, now + 30_000)
}

function isFailedEnvelope(
  body: unknown,
): body is { status: 'Failed'; msgList: Array<{ code?: string | null; text?: string | null }> } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    (body as { status?: unknown }).status === 'Failed'
  )
}
