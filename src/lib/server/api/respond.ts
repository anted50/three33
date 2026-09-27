import { ZodError } from 'zod'
import { apiErrorFromDb } from './db-errors'
import { ApiError } from './errors'

/**
 * Every API route handler body goes through `handle`, so every endpoint
 * answers in the same shape:
 *
 *   success  -> the returned value as JSON (status 200, or `status`)
 *              undefined -> 204 No Content; a Response passes through as-is
 *   failure  -> { error: { code, message, details? } } — see errors.ts
 *
 * Money is always integer mungu; dates are ISO strings.
 */
export async function handle(
  fn: () => unknown,
  status = 200,
): Promise<Response> {
  try {
    const body = await fn()
    if (body instanceof Response) return body
    if (body === undefined) return new Response(null, { status: 204 })
    return Response.json(body, { status })
  } catch (error) {
    return errorResponse(error)
  }
}

export function errorResponse(error: unknown): Response {
  const apiError = toApiError(error)
  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details === undefined ? {} : { details: apiError.details }),
      },
    },
    { status: apiError.status },
  )
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (error instanceof ZodError) {
    return new ApiError(400, 'VALIDATION', 'Invalid input', error.issues)
  }

  const fromDb = apiErrorFromDb(error)
  if (fromDb) return fromDb

  console.error('api: unhandled error', error)
  return new ApiError(500, 'INTERNAL', 'Something went wrong')
}
