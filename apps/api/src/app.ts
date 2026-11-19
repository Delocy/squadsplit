import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import type { AuthDeps } from './deps'
import type { AppEnv } from './env'
import { HttpError, errorBody, handleError, payloadTooLarge } from './errors'
import { expenseRoutes, groupExpenseRoutes } from './routes/expenses'
import { funRoutes } from './routes/fun'
import { groupRoutes } from './routes/groups'
import { inviteRoutes } from './routes/invites'
import { meRoutes } from './routes/me'
import { RECEIPT_SCAN_PATH, receiptRoutes } from './routes/receipts'
import { groupSettlementRoutes, settlementRoutes } from './routes/settlements'
import { ensureUser, isPlaceholderId } from './users'

/** The largest request body on every route except a receipt scan. */
const BODY_LIMIT = 64 * 1024

/** Verifies the bearer token and sets `c.var.userId`. */
const authenticate =
  (deps: AuthDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    const userId = token ? await deps.verifyToken(token) : null
    // A placeholder's id is never a signed-in user's, so nobody can act as a name that hasn't been claimed.
    if (!userId || isPlaceholderId(userId)) throw new HttpError(401, 'unauthenticated', 'Sign in required')
    c.set('userId', userId)
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

  // Bodies are small JSON everywhere except a receipt scan, which brings its photo and sets its own larger limit.
  const smallBodies = bodyLimit({ maxSize: BODY_LIMIT, onError: payloadTooLarge })
  app.use('*', (c, next) => (RECEIPT_SCAN_PATH.test(c.req.path) ? next() : smallBodies(c, next)))

  app.use('*', authenticate(deps))
  // /me upserts the user itself with a fresh profile, so it is mounted before ensureUser.
  app.route('/me', meRoutes(deps))
  // Every route mounted below this line can rely on the caller's users row existing.
  app.use('*', ensureUser(deps))
  app.route('/groups', groupRoutes())
  app.route('/groups', groupExpenseRoutes())
  app.route('/groups', groupSettlementRoutes())
  app.route('/groups', funRoutes())
  app.route('/groups', receiptRoutes())
  app.route('/expenses', expenseRoutes())
  app.route('/invites', inviteRoutes())
  app.route('/settlements', settlementRoutes())

  return app
}
