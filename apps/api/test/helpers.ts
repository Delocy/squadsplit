import { env } from 'cloudflare:test'
import { createApp } from '../src/app'
import { db as dbFor } from '../src/db'
import type { AuthDeps } from '../src/deps'

/** Fake auth: the bearer token is the user id, and the display name is `User <id>`. */
export const fakeDeps: AuthDeps = {
  verifyToken: async (token) => token || null,
  fetchProfile: async (userId) => ({ displayName: `User ${userId}`, avatarUrl: null }),
}

type Send = (path: string, init?: RequestInit) => Promise<Response>

export function testApp() {
  const app = createApp(fakeDeps)
  const send: Send = async (path, init) => app.request(path, init, env)

  return {
    /** Sends the request as `userId` (fake bearer token). */
    as:
      (userId: string): Send =>
      (path, init) => {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Bearer ${userId}`)
        return send(path, { ...init, headers })
      },
    /** Sends the request without an Authorization header. */
    anon: send,
  }
}

/** Drizzle on the test D1 binding, for seeding and asserting rows. */
export const db = () => dbFor(env)

/** RequestInit for a JSON body. */
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
