/**
 * The one error type API handlers throw. Everything that reaches a client as
 * an error goes out as
 *
 *   { "error": { "code": "NOT_FOUND", "message": "...", "details": ... } }
 *
 * with the HTTP status below — see respond.ts. `code` is stable and meant for
 * the UI to branch on; `message` is for humans and may change.
 *
 * Pure: no database or framework imports, so domain logic can throw these and
 * still be unit tested.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details)

export const unauthorized = (message = 'Sign in first') =>
  new ApiError(401, 'UNAUTHORIZED', message)

export const forbidden = (message = 'Not allowed') =>
  new ApiError(403, 'FORBIDDEN', message)

export const notFound = (what: string) =>
  new ApiError(404, 'NOT_FOUND', `${what} not found`)

export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details)
