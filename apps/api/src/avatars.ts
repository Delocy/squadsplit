import { and, eq, isNull } from 'drizzle-orm'
import { effectiveAvatar, firstFreeAvatar, sameAvatar, type AvatarChoice } from '@squadsplit/shared'
import type { Db } from './db'
import { memberships } from './db/schema'
import { HttpError, isUniqueViolation } from './errors'

type StoredLook = { userId: string; animal: string | null; color: string | null }

/**
 * The looks active members are shown with, given in join order. Each gets their effective look, unless an earlier
 * joiner already shows it (two defaults that hash alike, or a stored look matching an earlier default): then they
 * move on to the first free look, so no two active members ever look the same.
 */
export function distinctLooks(activeInJoinOrder: StoredLook[]): { userId: string; avatar: AvatarChoice }[] {
  const shown: AvatarChoice[] = []
  return activeInJoinOrder.map(({ userId, animal, color }) => {
    const avatar = firstFreeAvatar(effectiveAvatar(userId, { animal, color }), shown)
    shown.push(avatar)
    return { userId, avatar }
  })
}

/** The group's active members with the looks they are shown with, in join order. */
export async function activeMemberAvatars(d: Db, groupId: string): Promise<{ userId: string; avatar: AvatarChoice }[]> {
  const rows = await d
    .select({ userId: memberships.userId, animal: memberships.avatarAnimal, color: memberships.avatarColor })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)))
    .orderBy(memberships.joinedAt, memberships.userId)
  return distinctLooks(rows)
}

const avatarTaken = () => new HttpError(409, 'avatar_taken', 'Someone in this group already looks like that — pick another.')

/** 409 avatar_taken if someone in `taken` already looks like `avatar`. */
export function ensureAvatarFree(avatar: AvatarChoice, taken: AvatarChoice[]): void {
  if (taken.some((t) => sameAvatar(t, avatar))) throw avatarTaken()
}

/**
 * Runs a write that stores a look. If another active member stored the same look in the meantime (after
 * ensureAvatarFree passed), the unique index refuses it, and that becomes the same 409 avatar_taken.
 */
export async function storingLook<T>(write: Promise<T>): Promise<T> {
  try {
    return await write
  } catch (err) {
    if (isUniqueViolation(err, 'memberships.group_id, memberships.avatar_animal, memberships.avatar_color')) throw avatarTaken()
    throw err
  }
}

/** The membership columns that store an avatar. */
export const avatarColumns = (avatar: AvatarChoice) => ({ avatarAnimal: avatar.animal, avatarColor: avatar.color })
