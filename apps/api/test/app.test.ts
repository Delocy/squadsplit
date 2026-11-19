import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ApiErrorBody } from '@squadsplit/shared'
import { createApp } from '../src/app'
import { users } from '../src/db/schema'
import type { AuthDeps } from '../src/deps'
import { HttpError, parseBody } from '../src/errors'
import { db, fakeDeps } from './helpers'

function appWithRoutes(deps: AuthDeps = fakeDeps) {
  const app = createApp(deps)
  app.get('/ping', (c) => c.json({ userId: c.var.userId }))
  app.get('/conflict', () => {
    throw new HttpError(409, 'locked', 'Expense is locked')
  })
  app.get('/invalid', () => {
    z.object({ name: z.string() }).parse({})
    return new Response()
  })
  app.get('/boom', () => {
    throw new Error('secret internals')
  })
  app.get('/http-exception', () => {
    throw new HTTPException(413, { message: 'Payload too large' })
  })
  app.get('/foreign-zod-error', () => {
    // A ZodError from another copy of zod fails `instanceof`, but keeps its name and issues.
    throw Object.assign(new Error('invalid'), { name: 'ZodError', issues: [{ path: ['amount'], message: 'Too small' }] })
  })
  app.post('/echo', async (c) => c.json(await parseBody(c, z.object({ name: z.string() }))))
  const send = (path: string, userId = 'alice', init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${userId}` } }, env)
  return { send }
}

/** Fake deps whose fetchProfile is a spy, so tests can count Clerk profile lookups. */
const countingDeps = (displayName = (id: string) => `User ${id}`) => ({
  verifyToken: fakeDeps.verifyToken,
  fetchProfile: vi.fn(async (id: string) => ({ displayName: displayName(id), avatarUrl: null })),
})

describe('auth', () => {
  it('rejects a token the verifier does not accept', async () => {
    const { send } = appWithRoutes({ ...fakeDeps, verifyToken: async () => null })
    const res = await send('/ping')
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('unauthenticated')
  })

  it('exposes the verified user id to routes', async () => {
    const res = await appWithRoutes().send('/ping', 'bob')
    expect(await res.json()).toEqual({ userId: 'bob' })
  })

  it('creates the users row on first sight and does not refetch the profile afterwards', async () => {
    const deps = countingDeps()
    const { send } = appWithRoutes(deps)

    await send('/ping')
    await send('/ping')

    expect(deps.fetchProfile).toHaveBeenCalledTimes(1)
    const rows = await db().select().from(users)
    expect(rows).toMatchObject([{ id: 'alice', displayName: 'User alice', avatarUrl: null }])
  })

  it('GET /me refreshes an existing profile, fetching it once', async () => {
    await db().insert(users).values({ id: 'alice', displayName: 'Old name', avatarUrl: null, createdAt: '2026-01-01T00:00:00.000Z' })
    const deps = countingDeps(() => 'New name')
    const app = createApp(deps)

    const res = await app.request('/me', { headers: { Authorization: 'Bearer alice' } }, env)

    expect(await res.json()).toEqual({ id: 'alice', displayName: 'New name', avatarUrl: null })
    expect(deps.fetchProfile).toHaveBeenCalledTimes(1)
    const row = await db().select().from(users).where(eq(users.id, 'alice')).get()
    expect(row).toMatchObject({ displayName: 'New name', createdAt: '2026-01-01T00:00:00.000Z' })
  })
})

describe('errors', () => {
  it('maps HttpError to its status and code', async () => {
    const res = await appWithRoutes().send('/conflict')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual<ApiErrorBody>({ error: { code: 'locked', message: 'Expense is locked' } })
  })

  it('maps ZodError to 422 validation_failed', async () => {
    const res = await appWithRoutes().send('/invalid')
    expect(res.status).toBe(422)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.message).toContain('name')
  })

  it('maps a ZodError by name, not only by instanceof', async () => {
    const res = await appWithRoutes().send('/foreign-zod-error')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual<ApiErrorBody>({ error: { code: 'validation_failed', message: 'amount: Too small' } })
  })

  it('maps a Hono HTTPException to its own status', async () => {
    const res = await appWithRoutes().send('/http-exception')
    expect(res.status).toBe(413)
    expect(((await res.json()) as ApiErrorBody).error.message).toBe('Payload too large')
  })

  it('parseBody returns the validated body', async () => {
    const res = await appWithRoutes().send('/echo', 'alice', { method: 'POST', body: JSON.stringify({ name: 'x', extra: 1 }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'x' })
  })

  it('maps a body that is not JSON to 422 validation_failed', async () => {
    const res = await appWithRoutes().send('/echo', 'alice', { method: 'POST', body: '{not json' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('validation_failed')
  })

  it('maps anything else to 500 internal without leaking the message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await appWithRoutes().send('/boom')
    expect(res.status).toBe(500)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('internal')
    expect(body.error.message).not.toContain('secret')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('answers unknown routes with a JSON 404', async () => {
    const res = await appWithRoutes().send('/nope')
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found')
  })
})
