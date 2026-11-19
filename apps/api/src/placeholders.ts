import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { defaultAvatar, firstFreeAvatar, MAX_GROUP_MEMBERS, type AvatarChoice } from '@squadsplit/shared'
import type { Db } from './db'
import { expenseItemUsers, expenseShares, expenses, memberships, settlements, spins, users } from './db/schema'
import { PLACEHOLDER_ID_PREFIX } from './users'

// A placeholder is a name in one group for someone who hasn't joined yet: a `users` row of kind 'placeholder'
// (never seen by Clerk) with an ordinary membership. They take part in the money like anyone else. When the
// person joins and claims the name, every reference moves to their own id and the placeholder row is deleted.

export interface NewPlaceholder {
  id: string
  name: string
  avatar: AvatarChoice
}

/** New placeholders for `names`, each with its own look, free among `taken` and the ones before it. */
export function newPlaceholders(names: string[], taken: AvatarChoice[]): NewPlaceholder[] {
  const shown = [...taken]
  return names.map((name) => {
    const id = `${PLACEHOLDER_ID_PREFIX}${crypto.randomUUID()}`
    const avatar = firstFreeAvatar(defaultAvatar(id), shown)
    shown.push(avatar)
    return { id, name, avatar }
  })
}

/** The rows for a placeholder in a group: its user (named as typed) and its membership. */
export function insertPlaceholder(d: Db, groupId: string, p: NewPlaceholder, joinedAt: string) {
  return [
    d.insert(users).values({ id: p.id, displayName: p.name, avatarUrl: null, createdAt: joinedAt, kind: 'placeholder' }),
    d.insert(memberships).values({
      groupId, userId: p.id, role: 'member', joinedAt, avatarAnimal: p.avatar.animal, avatarColor: p.avatar.color,
    }),
  ] as const
}

/**
 * Like insertPlaceholder, but only while the group has room, checked in the statements themselves so a join at
 * the same moment can't take it past the cap. When it is full neither row is written: the membership is only
 * written for a user row that was.
 */
export function insertPlaceholderIfRoom(d: Db, groupId: string, p: NewPlaceholder, joinedAt: string) {
  const activeCount = sql`(SELECT COUNT(*) FROM ${memberships} WHERE ${memberships.groupId} = ${groupId} AND ${memberships.leftAt} IS NULL)`
  // Columns in table order: users (id, name, avatar url, created, kind, profile animal, profile colour);
  // memberships (group, user, role, joined, left, animal, colour, nickname).
  return [
    d.insert(users).select(
      sql`SELECT ${p.id}, ${p.name}, NULL, ${joinedAt}, 'placeholder', NULL, NULL WHERE ${activeCount} < ${MAX_GROUP_MEMBERS}`,
    ),
    d
      .insert(memberships)
      .select(
        sql`SELECT ${groupId}, ${p.id}, 'member', ${joinedAt}, NULL, ${p.avatar.animal}, ${p.avatar.color}, NULL
            WHERE EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${p.id})`,
      )
      .returning({ userId: memberships.userId }),
  ] as const
}

/** The group's unclaimed names: active memberships of placeholder users, with their names. */
export async function groupPlaceholders(d: Db, groupId: string): Promise<{ userId: string; name: string }[]> {
  return d
    .select({ userId: users.id, name: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt), eq(users.kind, 'placeholder')))
    .orderBy(memberships.joinedAt, memberships.userId)
}

/** Whether anything in the group's history names the placeholder: an expense, a share, an item, a settlement or a spin. */
export async function placeholderInUse(d: Db, userId: string): Promise<boolean> {
  const results = await d.batch([
    d.select({ id: expenses.id }).from(expenses).where(or(eq(expenses.paidBy, userId), eq(expenses.createdBy, userId))).limit(1),
    d.select({ id: expenseShares.expenseId }).from(expenseShares).where(eq(expenseShares.userId, userId)).limit(1),
    d.select({ id: expenseItemUsers.itemId }).from(expenseItemUsers).where(eq(expenseItemUsers.userId, userId)).limit(1),
    d
      .select({ id: settlements.id })
      .from(settlements)
      .where(or(eq(settlements.fromUserId, userId), eq(settlements.toUserId, userId)))
      .limit(1),
    d.select({ id: spins.id }).from(spins).where(or(eq(spins.winnerId, userId), eq(spins.spunBy, userId))).limit(1),
  ])
  return results.some((rows) => rows.length > 0)
}

/** Deletes a placeholder that nothing refers to: its membership, then its user. */
export function deletePlaceholder(d: Db, groupId: string, userId: string) {
  return [
    d.delete(memberships).where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId))),
    d.delete(users).where(and(eq(users.id, userId), eq(users.kind, 'placeholder'))),
  ] as const
}

/**
 * The caller (`userId`) becomes the placeholder everywhere, as one batch: their membership takes the placeholder's
 * place (with `look` and `nickname`, joined now); every expense, share, item, settlement and spin (with the spin's
 * weights) moves to them; and the placeholder's user row goes. The caller has never been in the group, so no moved row can clash with
 * one of theirs. The first statement returns the membership it moved: none means someone claimed it first, and
 * then every other statement finds nothing to move either.
 */
export function claimPlaceholder(
  d: Db,
  claim: { groupId: string; placeholderId: string; userId: string; avatar: AvatarChoice; nickname: string | null; now: string },
) {
  const { groupId, placeholderId: from, userId: to } = claim
  return [
    d
      .update(memberships)
      .set({ userId: to, joinedAt: claim.now, avatarAnimal: claim.avatar.animal, avatarColor: claim.avatar.color, nickname: claim.nickname })
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, from), isNull(memberships.leftAt)))
      .returning({ userId: memberships.userId }),
    d.update(expenses).set({ paidBy: to }).where(eq(expenses.paidBy, from)),
    d.update(expenses).set({ createdBy: to }).where(eq(expenses.createdBy, from)),
    d.update(expenseShares).set({ userId: to }).where(eq(expenseShares.userId, from)),
    d.update(expenseItemUsers).set({ userId: to }).where(eq(expenseItemUsers.userId, from)),
    d.update(settlements).set({ fromUserId: to }).where(eq(settlements.fromUserId, from)),
    d.update(settlements).set({ toUserId: to }).where(eq(settlements.toUserId, from)),
    d.update(spins).set({ winnerId: to }).where(eq(spins.winnerId, from)),
    d.update(spins).set({ spunBy: to }).where(eq(spins.spunBy, from)),
    // A spin's weights are keyed by user id. Both ids are plain (Clerk's, or ph_ and a uuid), so the quoted key is
    // unique in the JSON and can be swapped as text.
    d
      .update(spins)
      .set({ weightsJson: sql`replace(${spins.weightsJson}, ${JSON.stringify(from)}, ${JSON.stringify(to)})` })
      .where(and(eq(spins.groupId, groupId), sql`instr(${spins.weightsJson}, ${JSON.stringify(from)}) > 0`)),
    d.delete(users).where(and(eq(users.id, from), eq(users.kind, 'placeholder'))),
  ] as const
}
