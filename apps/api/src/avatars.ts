import { and, eq, isNull } from 'drizzle-orm'
import { effectiveAvatar, sameAvatar, type AvatarChoice } from '@squadsplit/shared'
import type { Db } from './db'
import { memberships } from './db/schema'
import { HttpError } from './errors'

/** The group's active members with their effective avatars, in join order. */
export async function activeMemberAvatars(d: Db, groupId: string): Promise<{ userId: string; avatar: AvatarChoice }[]> {
  const rows = await d
    .select({ userId: memberships.userId, animal: memberships.avatarAnimal, color: memberships.avatarColor })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)))
    .orderBy(memberships.joinedAt, memberships.userId)
  return rows.map(({ userId, animal, color }) => ({ userId, avatar: effectiveAvatar(userId, { animal, color }) }))
}

/** 409 avatar_taken if someone in `taken` already looks like `avatar`. */
export function ensureAvatarFree(avatar: AvatarChoice, taken: AvatarChoice[]): void {
  if (taken.some((t) => sameAvatar(t, avatar))) {
    throw new HttpError(409, 'avatar_taken', 'Someone in this group already looks like that — pick another.')
  }
}

/** The membership columns that store an avatar. */
export const avatarColumns = (avatar: AvatarChoice) => ({ avatarAnimal: avatar.animal, avatarColor: avatar.color })
