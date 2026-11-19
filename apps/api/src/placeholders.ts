import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { defaultAvatar, firstFreeAvatar, MAX_GROUP_MEMBERS, type AvatarChoice } from '@squadsplit/shared'
import type { Db } from './db'
import { expenseItemUsers, expenseShares, expenses, guestSessions, memberships, settlements, spins, users, type USER_KINDS } from './db/schema'
import { endGuestSessions, hasLiveSession } from './guests/sessions'
import { PLACEHOLDER_ID_PREFIX } from './users'

// A placeholder is a name in one group for someone who hasn't joined yet: a `users` row of kind 'placeholder'
// (never seen by Clerk) with an ordinary membership. They take part in the money like anyone else. When the
// person joins and claims the name, every reference moves to their own id and the placeholder row is deleted.
//
// A guest is a name in one group too (kind 'guest'), signed in on a phone with no account. A guest signed out on
// every phone (by a reset link or "Free up name") is an unclaimed name again, claimable exactly like a placeholder.

/** The kinds of user that are only a name in one group, never an account. */
const NAME_KINDS = ['placeholder', 'guest'] as const satisfies (typeof USER_KINDS)[number][]

/**
 * SQL, inside a query over `users`: whether the user (by id, or a column holding it) is a name someone can claim, a
 * placeholder or a signed-out guest.
 */
export const unclaimed = (userId: Parameters<typeof hasLiveSession>[0]) =>
  sql`(${users.kind} = 'placeholder' OR (${users.kind} = 'guest' AND NOT ${hasLiveSession(userId)}))`

/** SQL: `userId` is one of the group's unclaimed names right now (an active member, and unclaimed). */
export const claimableIn = (groupId: string, userId: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${memberships} INNER JOIN ${users} ON ${users.id} = ${memberships.userId}
      WHERE ${memberships.groupId} = ${groupId} AND ${memberships.userId} = ${userId} AND ${memberships.leftAt} IS NULL
        AND ${unclaimed(userId)})`

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
 * written for a user row that was. A new guest is written this way too (`kind` 'guest', maybe with a nickname).
 */
export function insertNameIfRoom(
  d: Db,
  groupId: string,
  p: NewPlaceholder,
  joinedAt: string,
  { kind = 'placeholder', nickname = null }: { kind?: (typeof NAME_KINDS)[number]; nickname?: string | null } = {},
) {
  const activeCount = sql`(SELECT COUNT(*) FROM ${memberships} WHERE ${memberships.groupId} = ${groupId} AND ${memberships.leftAt} IS NULL)`
  // Columns in table order: users (id, name, avatar url, created, kind, profile animal, profile colour);
  // memberships (group, user, role, joined, left, animal, colour, nickname).
  return [
    d.insert(users).select(
      sql`SELECT ${p.id}, ${p.name}, NULL, ${joinedAt}, ${kind}, NULL, NULL WHERE ${activeCount} < ${MAX_GROUP_MEMBERS}`,
    ),
    d
      .insert(memberships)
      .select(
        sql`SELECT ${groupId}, ${p.id}, 'member', ${joinedAt}, NULL, ${p.avatar.animal}, ${p.avatar.color}, ${nickname}
            WHERE EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${p.id})`,
      )
      .returning({ userId: memberships.userId }),
  ] as const
}

/**
 * The group's unclaimed names, in join order: active placeholders, and guests signed out on every phone. A name is
 * what the group calls them (a guest may have set a nickname).
 */
export async function unclaimedNames(d: Db, groupId: string): Promise<{ userId: string; name: string }[]> {
  return d
    .select({ userId: users.id, name: sql<string>`coalesce(${memberships.nickname}, ${users.displayName})` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt), unclaimed(users.id)))
    .orderBy(memberships.joinedAt, memberships.userId)
}

/** Whether the user is only a name in a group (a placeholder or a guest), never an account. */
export async function isNameOnly(d: Db, userId: string): Promise<boolean> {
  const row = await d.select({ kind: users.kind }).from(users).where(eq(users.id, userId)).get()
  return row !== undefined && (NAME_KINDS as readonly string[]).includes(row.kind)
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

/** Deletes a placeholder or guest that nothing refers to: its sessions, its membership, then its user. */
export function deletePlaceholder(d: Db, groupId: string, userId: string) {
  return [
    endGuestSessions(d, userId),
    d.delete(memberships).where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId))),
    d.delete(users).where(and(eq(users.id, userId), inArray(users.kind, NAME_KINDS))),
  ] as const
}

/**
 * Someone with an account (`to`) takes a name's place everywhere, as one batch: claiming a placeholder or a
 * signed-out guest when joining, or a guest saving to an account. Their membership takes the name's place (with
 * whatever `membership` sets); every expense, share, item, settlement and spin (with the spin's weights) moves to
 * them; and the name's sessions and user row go. `to` has never been in the group, so no moved row can clash with
 * one of theirs (a membership of theirs that appears meanwhile makes the batch fail on the primary key).
 *
 * The first statement moves the membership only while `onlyIf` holds, and returns what it moved: none means the
 * name was taken first. Every later statement runs only once the move happened (`to` is in the group and `from` is
 * in none), so a name that is still in use (a guest's id lives on) has nothing else moved from under it.
 */
export function moveMember(
  d: Db,
  move: {
    groupId: string
    from: string
    to: string
    onlyIf: SQL
    membership: { joinedAt?: string; avatar?: AvatarChoice; nickname?: string | null }
  },
) {
  const { groupId, from, to, membership: m } = move
  const moved = sql`(EXISTS (SELECT 1 FROM ${memberships} WHERE ${memberships.groupId} = ${groupId} AND ${memberships.userId} = ${to})
    AND NOT EXISTS (SELECT 1 FROM ${memberships} WHERE ${memberships.userId} = ${from}))`
  return [
    d
      .update(memberships)
      .set({
        userId: to,
        ...(m.joinedAt !== undefined && { joinedAt: m.joinedAt }),
        ...(m.avatar && { avatarAnimal: m.avatar.animal, avatarColor: m.avatar.color }),
        ...(m.nickname !== undefined && { nickname: m.nickname }),
      })
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, from), isNull(memberships.leftAt), move.onlyIf))
      .returning({ userId: memberships.userId }),
    d.update(expenses).set({ paidBy: to }).where(and(eq(expenses.paidBy, from), moved)),
    d.update(expenses).set({ createdBy: to }).where(and(eq(expenses.createdBy, from), moved)),
    d.update(expenseShares).set({ userId: to }).where(and(eq(expenseShares.userId, from), moved)),
    d.update(expenseItemUsers).set({ userId: to }).where(and(eq(expenseItemUsers.userId, from), moved)),
    d.update(settlements).set({ fromUserId: to }).where(and(eq(settlements.fromUserId, from), moved)),
    d.update(settlements).set({ toUserId: to }).where(and(eq(settlements.toUserId, from), moved)),
    d.update(spins).set({ winnerId: to }).where(and(eq(spins.winnerId, from), moved)),
    d.update(spins).set({ spunBy: to }).where(and(eq(spins.spunBy, from), moved)),
    // A spin's weights are keyed by user id. Every id is plain (Clerk's, or ph_ or gs_ and a uuid), so the quoted key
    // is unique in the JSON and can be swapped as text.
    d
      .update(spins)
      .set({ weightsJson: sql`replace(${spins.weightsJson}, ${JSON.stringify(from)}, ${JSON.stringify(to)})` })
      .where(and(eq(spins.groupId, groupId), sql`instr(${spins.weightsJson}, ${JSON.stringify(from)}) > 0`, moved)),
    d.delete(guestSessions).where(and(eq(guestSessions.userId, from), moved)),
    d.delete(users).where(and(eq(users.id, from), inArray(users.kind, NAME_KINDS), moved)),
  ] as const
}
