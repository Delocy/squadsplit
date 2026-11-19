import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from './db'
import { memberships, type ROLES } from './db/schema'
import { HttpError } from './errors'

export type Role = (typeof ROLES)[number]

/** The user's role in the group, or undefined if they are not a current member (never joined, or left). */
export async function findActiveRole(db: Db, groupId: string, userId: string): Promise<Role | undefined> {
  const membership = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId), isNull(memberships.leftAt)))
    .get()
  return membership?.role
}

/** The caller's role in the group. 404 (not 403) for non-members and former members, so we never reveal that a group exists. */
export async function requireMember(db: Db, groupId: string, userId: string): Promise<{ role: Role }> {
  const role = await findActiveRole(db, groupId, userId)
  if (!role) throw new HttpError(404, 'not_found', 'Group not found')
  return { role }
}

/** Like requireMember, plus 403 for a member who is not the owner. */
export async function requireOwner(db: Db, groupId: string, userId: string): Promise<{ role: 'owner' }> {
  const { role } = await requireMember(db, groupId, userId)
  if (role !== 'owner') throw new HttpError(403, 'forbidden', 'Only the group owner can do that')
  return { role }
}

/** Whether the user has ever been in the group (a current or former member). */
export async function hasMembership(db: Db, groupId: string, userId: string): Promise<boolean> {
  const row = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .get()
  return row !== undefined
}
