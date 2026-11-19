import type { Context, ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError, type z } from 'zod'
import type { ApiErrorBody } from '@squadsplit/shared'

export class HttpError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Whether `err` is SQLite refusing a write on the unique constraint over `columns` ("table.col, table.col"). */
export function isUniqueViolation(err: unknown, columns: string): boolean {
  // Drizzle wraps the D1 error, so walk the cause chain.
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes(`UNIQUE constraint failed: ${columns}`)) return true
  }
  return false
}

/** Whether `err` is SQLite refusing a write that would leave a foreign key pointing at nothing. */
export function isForeignKeyViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes('FOREIGN KEY constraint failed')) return true
  }
  return false
}

/**
 * Runs a write that names members (an expense's people, a settlement's parties). If one of them stopped existing
 * after the write was checked (someone claimed a name, so its placeholder is gone), the foreign key refuses the
 * write, and that becomes a 409 instead of a 500.
 */
export async function refusingStaleMember<T>(write: Promise<T>): Promise<T> {
  try {
    return await write
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new HttpError(409, 'member_changed', 'Someone just joined as this name — refresh and try again.')
    throw err
  }
}

/** For hono's bodyLimit: a body over the route's limit. */
export const payloadTooLarge = (): never => {
  throw new HttpError(413, 'payload_too_large', 'That request is too large.')
}

export const errorBody =(code: string, message: string): ApiErrorBody => ({ error: { code, message } })

/** Reads the JSON request body and validates it. A malformed body or a schema mismatch becomes a 422. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const raw: unknown = await c.req.json().catch(() => {
    throw new HttpError(422, 'validation_failed', 'Request body must be valid JSON')
  })
  return schema.parse(raw)
}

/** Like parseBody, but an empty body is read as `{}`, for routes whose fields are all optional. */
export async function parseOptionalBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const text = await c.req.text()
  if (text.trim() === '') return schema.parse({})
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new HttpError(422, 'validation_failed', 'Request body must be valid JSON')
  }
  return schema.parse(raw)
}

// `instanceof` fails for a ZodError thrown by another copy of zod, so match the name too.
const isZodError = (err: Error): err is ZodError => err instanceof ZodError || err.name === 'ZodError'

export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status as ContentfulStatusCode)
  if (isZodError(err)) {
    const message = err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
    return c.json(errorBody('validation_failed', message), 422)
  }
  if (err instanceof HTTPException && err.status === 413) {
    return c.json(errorBody('payload_too_large', err.message || 'That request is too large.'), 413)
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody('http_error', err.message || 'Request failed'), err.status as ContentfulStatusCode)
  }
  console.error(err)
  return c.json(errorBody('internal', 'Something went wrong'), 500)
}
