import { eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db'
import { users } from './db/schema'
import type { AuthDeps } from './deps'
import type { AppEnv } from './env'
import { HttpError, errorBody, handleError } from './errors'
import { meRoutes } from './routes/me'

/** Verifies the bearer token and sets `c.var.userId`. */
const authenticate =
  (deps: AuthDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    const userId = token ? await deps.verifyToken(token) : null
    if (!userId) throw new HttpError(401, 'unauthenticated', 'Sign in required')
    c.set('userId', userId)
    await next()
  }

/** Creates the caller's `users` row the first time we see them. Never refetches an existing profile. */
const ensureUser =
  (deps: AuthDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const id = c.var.userId
    const existing = await db(c.env).select({ id: users.id }).from(users).where(eq(users.id, id)).get()
    if (!existing) {
      const profile = await deps.fetchProfile(id)
      await db(c.env)
        .insert(users)
        .values({ id, ...profile, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
    }
    await next()
  }

export function createApp(deps: AuthDeps) {
  const app = new Hono<AppEnv>()

  app.onError(handleError)
  app.notFound((c) => c.json(errorBody('not_found', 'Not found'), 404))

  app.use(
    '*',
    cors({
      origin: (origin, c) => (origin === (c.env as AppEnv['Bindings']).WEB_ORIGIN ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  app.use('*', authenticate(deps))
  // /me upserts the user itself with a fresh profile, so it is mounted before ensureUser.
  app.route('/me', meRoutes(deps))
  // Every route mounted below this line can rely on the caller's users row existing.
  app.use('*', ensureUser(deps))

  return app
}
