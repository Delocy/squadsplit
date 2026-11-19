import { HttpError } from '../errors'
import type { GuestSession } from './sessions'

// A guest is a member of one group and nothing else. Their own group's routes work as for any member (owner-only
// ones are 403, as for any member); expenses and settlements are checked against their group by the routes
// themselves. Anything that belongs to an account (/me, the group list, new groups, quick splits, signed-in joins)
// is 401.

const GROUP_ROUTE = /^\/groups\/([^/]+)(?:\/|$)/
const IN_SOME_GROUP = /^\/(?:expenses|settlements)\//

/** Saving a guest to an account: it takes both sign-ins (see app.ts). */
export const GUEST_UPGRADE_PATH = /^\/groups\/[^/]+\/guest\/upgrade$/

/** The id in a group route's path, or null when it doesn't decode (it can't be anyone's group then). */
function decodedId(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** Throws unless the guest may use `path`: 404 for another group (as for a non-member), 401 for an account's route. */
export function checkGuestScope(path: string, guest: GuestSession): void {
  const group = GROUP_ROUTE.exec(path)
  if (group) {
    if (decodedId(group[1]!) !== guest.groupId) throw new HttpError(404, 'not_found', 'Group not found')
    return
  }
  if (IN_SOME_GROUP.test(path)) return
  throw new HttpError(401, 'unauthenticated', 'Sign in to an account to do that')
}
