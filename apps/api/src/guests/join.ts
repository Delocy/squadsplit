import { and, eq, sql } from 'drizzle-orm'
import { defaultAvatar, firstFreeAvatar, MAX_GROUP_MEMBERS, type AvatarChoice } from '@squadsplit/shared'
import { activeMemberAvatars, avatarColumns, ensureAvatarFree, storingLook } from '../avatars'
import type { Db } from '../db'
import { guestSessions, memberships, users } from '../db/schema'
import { alreadyClaimed, groupFull } from '../membershipErrors'
import { claimableIn, insertNameIfRoom, unclaimedNames } from '../placeholders'
import { GUEST_ID_PREFIX } from '../users'
import { insertSessionIf, type GuestSession } from './sessions'

// Joining a group from its invite link with no account: as one of its unclaimed names, or as someone new. Either
// way the guest is signed in on this phone with a new session (`tokenHash`), in the same batch as the join.

type Look = { avatar?: AvatarChoice; nickname?: string | null }

/**
 * The guest becomes the unclaimed name in place: same id, so no row of the group's history moves. A placeholder
 * turns into a guest and joins now (a join in the feed); a signed-out guest just signs in again. 409 already_claimed
 * for a name that isn't one of the group's unclaimed names, or that someone else claimed at the same moment.
 */
export async function claimAsGuest(d: Db, groupId: string, nameId: string, input: Look, tokenHash: string, now: string): Promise<string> {
  if (!(await unclaimedNames(d, groupId)).some((n) => n.userId === nameId)) throw alreadyClaimed()
  const members = await activeMemberAvatars(d, groupId)
  // Read separately from the names above, so someone may have claimed it in between.
  const shownLook = members.find((m) => m.userId === nameId)?.avatar
  if (!shownLook) throw alreadyClaimed()
  if (input.avatar) ensureAvatarFree(input.avatar, members.filter((m) => m.userId !== nameId).map((m) => m.avatar))

  const session: GuestSession = { tokenHash, userId: nameId, groupId }
  // Every statement after the first runs only if the first wrote this session.
  const mine = sql`EXISTS (SELECT 1 FROM ${guestSessions} WHERE ${guestSessions.tokenHash} = ${tokenHash})`
  const thisMembership = and(eq(memberships.groupId, groupId), eq(memberships.userId, nameId), mine)
  const [written] = await storingLook(
    d.batch([
      insertSessionIf(d, session, now, claimableIn(groupId, nameId)),
      // A placeholder joins now; a guest coming back keeps the day they joined. Before the kind changes below.
      d
        .update(memberships)
        .set({ joinedAt: now })
        .where(and(thisMembership, sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${nameId} AND ${users.kind} = 'placeholder')`)),
      d
        .update(memberships)
        .set({ ...avatarColumns(input.avatar ?? shownLook), ...(input.nickname !== undefined && { nickname: input.nickname }) })
        .where(thisMembership),
      d.update(users).set({ kind: 'guest' }).where(and(eq(users.id, nameId), mine)),
    ]),
  )
  if (written.length === 0) throw alreadyClaimed()
  return nameId
}

/** "I'm new": a new guest (a `gs_` id named as typed) joins as a member, while the group has room. */
export async function joinAsNewGuest(
  d: Db,
  groupId: string,
  name: string,
  input: Look,
  tokenHash: string,
  now: string,
): Promise<string> {
  const members = await activeMemberAvatars(d, groupId)
  if (members.length >= MAX_GROUP_MEMBERS) throw groupFull()
  const taken = members.map((m) => m.avatar)
  const id = `${GUEST_ID_PREFIX}${crypto.randomUUID()}`
  if (input.avatar) ensureAvatarFree(input.avatar, taken)
  const avatar = input.avatar ?? firstFreeAvatar(defaultAvatar(id), taken)

  const [, written] = await storingLook(
    d.batch([
      ...insertNameIfRoom(d, groupId, { id, name, avatar }, now, { kind: 'guest', nickname: input.nickname ?? null }),
      insertSessionIf(
        d,
        { tokenHash, userId: id, groupId },
        now,
        sql`EXISTS (SELECT 1 FROM ${memberships} WHERE ${memberships.groupId} = ${groupId} AND ${memberships.userId} = ${id})`,
      ),
    ]),
  )
  if (written.length === 0) throw groupFull()
  return id
}
