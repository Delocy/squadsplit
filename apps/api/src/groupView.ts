import { asc, eq, sql } from 'drizzle-orm'
import { effectiveAvatar, type Currency, type GroupDTO } from '@squadsplit/shared'
import { distinctLooks } from './avatars'
import type { Db } from './db'
import { groups, guestSessions, memberships, users } from './db/schema'
import { HttpError } from './errors'

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The group as its members see it. Every member, guests too, sees the invite code, so anyone can share the link. */
export async function groupDTO(d: Db, groupId: string): Promise<GroupDTO> {
  const [[group], members, sessions] = await d.batch([
    d.select().from(groups).where(eq(groups.id, groupId)).limit(1),
    d
      .select({
        userId: memberships.userId,
        profileName: users.displayName,
        nickname: memberships.nickname,
        avatarUrl: users.avatarUrl,
        role: memberships.role,
        joinedAt: memberships.joinedAt,
        leftAt: memberships.leftAt,
        avatarAnimal: memberships.avatarAnimal,
        avatarColor: memberships.avatarColor,
        kind: users.kind,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.groupId, groupId))
      // Owner first (false sorts before true), then by join time.
      .orderBy(sql`${memberships.role} <> 'owner'`, asc(memberships.joinedAt), asc(memberships.userId)),
    d.selectDistinct({ userId: guestSessions.userId }).from(guestSessions).where(eq(guestSessions.groupId, groupId)),
  ])
  const signedIn = new Set(sessions.map((s) => s.userId))
  if (!group) throw new HttpError(404, 'not_found', 'Group not found')
  // Active members are shown with distinct looks, settled in join order (as activeMemberAvatars sorts them:
  // join time, then user id, compared as plain strings like SQLite does); former members with their own look.
  const activeInJoinOrder = members
    .filter((m) => m.leftAt === null)
    .sort((a, b) => compareStrings(a.joinedAt, b.joinedAt) || compareStrings(a.userId, b.userId))
    .map((m) => ({ userId: m.userId, animal: m.avatarAnimal, color: m.avatarColor }))
  const shown = new Map(distinctLooks(activeInJoinOrder).map((m) => [m.userId, m.avatar]))
  return {
    id: group.id,
    name: group.name,
    emoji: group.emoji,
    currency: group.currency as Currency,
    inviteCode: group.inviteCode,
    ownerId: group.ownerId,
    members: members.map(({ profileName, joinedAt: _joinedAt, leftAt, avatarAnimal, avatarColor, kind, ...m }) => ({
      ...m,
      displayName: m.nickname ?? profileName,
      active: leftAt === null,
      avatar: shown.get(m.userId) ?? effectiveAvatar(m.userId, { animal: avatarAnimal, color: avatarColor }),
      // A guest signed out on every phone is an unclaimed name again, like a placeholder.
      placeholder: kind === 'placeholder' || (kind === 'guest' && !signedIn.has(m.userId)),
      guest: kind === 'guest' && signedIn.has(m.userId),
    })),
  }
}
