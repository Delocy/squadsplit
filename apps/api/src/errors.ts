import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import type { ApiErrorBody } from '@squadsplit/shared'

export class HttpError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const errorBody = (code: string, message: string): ApiErrorBody => ({ error: { code, message } })

export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status as ContentfulStatusCode)
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
    return c.json(errorBody('validation_failed', message), 422)
  }
  console.error(err)
  return c.json(errorBody('internal', 'Something went wrong'), 500)
}
