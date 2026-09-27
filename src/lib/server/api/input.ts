import { z } from 'zod'
import { badRequest } from './errors'

/**
 * Input readers. Every value an API route uses comes through one of these and
 * a zod schema — body, query string and path params alike. A ZodError thrown
 * here becomes a 400 VALIDATION response in respond.ts.
 */

/** An empty body reads as {} so action endpoints with only optional fields
 * (…/cancel, …/void) can be called without one. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    const text = await request.text()
    raw = text.trim() ? JSON.parse(text) : {}
  } catch {
    throw badRequest('Body must be valid JSON')
  }
  return schema.parse(raw)
}

export function readQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const params = new URL(request.url).searchParams
  return schema.parse(Object.fromEntries(params))
}

export function readParams<T>(params: unknown, schema: z.ZodType<T>): T {
  return schema.parse(params)
}

/** One uuid path param. A malformed id is a 400, never a database error. */
export function readId(params: Record<string, string>, key: string): string {
  return z.object({ [key]: z.uuid() }).parse(params)[key] as string
}

/** Client IP and user agent, recorded on new sessions. */
export function requestMeta(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    userAgent: request.headers.get('user-agent'),
    ip: forwarded ? forwarded.split(',')[0]!.trim() : null,
  }
}

// Shared field schemas -------------------------------------------------------

export const idParam = z.uuid()

/** YYYY-MM-DD, as a local Ulaanbaatar date. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

/** HH:MM on a 24h clock; 24:00 means midnight at the end of the day. */
export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Expected HH:MM')

/** Integer mungu (tugrik × 100). Never a float. */
export const mungu = z.number().int().min(0).max(1_000_000_000_00)

/** Mongolian mobile numbers are 8 digits. */
export const phone = z.string().trim().regex(/^\d{8}$/, 'Expected 8 digits')

export const email = z.email().max(255).transform((v) => v.trim().toLowerCase())

/** Comma-separated uuids in a query string: ?serviceIds=a,b */
export const uuidList = z
  .string()
  .transform((v) => v.split(',').filter(Boolean))
  .pipe(z.array(z.uuid()).max(10))
