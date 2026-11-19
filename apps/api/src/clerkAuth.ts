import type { Context } from 'hono'
import type { AuthDeps } from './deps'
import { HttpError } from './errors'
import { isNameId } from './users'

export const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Sign in required')

/**
 * The signed-in account from `Authorization: Bearer <Clerk session token>`, or null when the request has no
 * Authorization header. 401 for a token that doesn't verify, and for a name's id (a placeholder's or a guest's is
 * never a signed-in user's, so nobody can act as a name through Clerk).
 */
export async function signedInUser(deps: AuthDeps, c: Context): Promise<string | null> {
  const header = c.req.header('Authorization')
  if (header === undefined) return null
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const userId = token ? await deps.verifyToken(token) : null
  if (!userId || isNameId(userId)) throw unauthenticated()
  return userId
}
