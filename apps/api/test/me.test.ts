import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ApiErrorBody, MeDTO } from '@squadsplit/shared'
import { users } from '../src/db/schema'
import { db, testApp } from './helpers'

const app = testApp()

describe('GET /health', () => {
  it('is public', async () => {
    const res = await app.anon('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('GET /me', () => {
  it('rejects a request without a token', async () => {
    const res = await app.anon('/me')
    expect(res.status).toBe(401)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('unauthenticated')
  })

  it('rejects an empty bearer token', async () => {
    const res = await app.anon('/me', { headers: { Authorization: 'Bearer ' } })
    expect(res.status).toBe(401)
  })

  it('returns the caller and creates their users row', async () => {
    const res = await app.as('alice')('/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<MeDTO>({ id: 'alice', displayName: 'User alice', avatarUrl: null })

    const rows = await db().select().from(users).where(eq(users.id, 'alice'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.displayName).toBe('User alice')
  })

  it('does not create a second row on a second call', async () => {
    await app.as('alice')('/me')
    await app.as('alice')('/me')
    const rows = await db().select().from(users).where(eq(users.id, 'alice'))
    expect(rows).toHaveLength(1)
  })

  it('starts each test with an empty database', async () => {
    expect(await db().select().from(users)).toEqual([])
  })
})

describe('CORS', () => {
  it('allows only WEB_ORIGIN', async () => {
    const ok = await app.anon('/health', { headers: { Origin: 'http://localhost:5173' } })
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')

    const other = await app.anon('/health', { headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers preflight without a token and keeps CORS headers on errors', async () => {
    const origin = 'http://localhost:5173'
    const preflight = await app.anon('/me', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin)

    const unauthenticated = await app.anon('/me', { headers: { Origin: origin } })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  })
})
