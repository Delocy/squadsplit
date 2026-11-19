import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { GUEST_TOKEN_HEADER } from '@squadsplit/shared'
import { signedInUser, unauthenticated } from './clerkAuth'
import { db } from './db'
import type { AuthDeps } from './deps'
import type { AppEnv } from './env'
import { errorBody, handleError, payloadTooLarge } from './errors'
import { checkGuestScope, GUEST_UPGRADE_PATH } from './guests/scope'
import { guestByToken } from './guests/sessions'
import { expenseRoutes, groupExpenseRoutes } from './routes/expenses'
import { funRoutes } from './routes/fun'
import { groupRoutes } from './routes/groups'
import { inviteRoutes, publicInviteRoutes } from './routes/invites'
import { meRoutes } from './routes/me'
import { quickSplitRoutes } from './routes/quickSplits'
import { RECEIPT_SCAN_PATH, receiptRoutes, standaloneReceiptRoutes } from './routes/receipts'
import { groupSettlementRoutes, settlementRoutes } from './routes/settlements'
import { shareLinkRoutes } from './routes/shareLinks'
import { ensureUser } from './users'

/** The largest request body on every route except a receipt scan. */
const BODY_LIMIT = 64 * 1024

/**
 * Signs the request in and sets `c.var.userId`: an account by its Clerk bearer token, or a guest by their
 * `X-Guest-Token` (then `c.var.guest` too, and only their own group's routes work). A request carrying both is the
 * guest's (a signed-in phone using a group it is only a guest in), except saving the guest to the account, which
 * takes both: `userId` is then the account's.
 */
const authenticate =
  (deps: AuthDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const guestToken = c.req.header(GUEST_TOKEN_HEADER)
    const guest = guestToken === undefined ? undefined : await guestByToken(db(c.env), guestToken)
    // A token that signs nobody in (unknown, or signed out by a reset or "Free up name") is never ignored.
    if (guestToken !== undefined && !guest) throw unauthenticated()

    if (GUEST_UPGRADE_PATH.test(c.req.path)) {
      const account = await signedInUser(deps, c)
      if (!account || !guest) throw unauthenticated()
      c.set('userId', account)
      c.set('guest', guest)
    } else if (guest) {
      checkGuestScope(c.req.path, guest)
      c.set('userId', guest.userId)
      c.set('guest', guest)
    } else {
      const account = await signedInUser(deps, c)
      if (!account) throw unauthenticated()
      c.set('userId', account)
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
      allowHeaders: ['Authorization', 'Content-Type', GUEST_TOKEN_HEADER],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  // Bodies are small JSON everywhere except a receipt scan, which brings its photo and sets its own larger limit.
  const smallBodies = bodyLimit({ maxSize: BODY_LIMIT, onError: payloadTooLarge })
  app.use('*', (c, next) => (RECEIPT_SCAN_PATH.test(c.req.path) ? next() : smallBodies(c, next)))

  // A quick split's share link works with no sign-in, so it is mounted before authentication: its handlers answer
  // without ever reaching the middleware below.
  app.route('/s', shareLinkRoutes())
  // So is an invite's preview, and joining from it as a guest (no account); signed-in joins come after authentication.
  app.route('/invites', publicInviteRoutes(deps))

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
  app.route('/quick-splits', quickSplitRoutes())
  app.route('/receipts', standaloneReceiptRoutes())

  return app
}
