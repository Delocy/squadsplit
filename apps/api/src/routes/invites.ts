import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  INVITE_CODE_ALPHABET as ALPHABET,
  INVITE_CODE_LENGTH as CODE_LENGTH,
  effectiveAvatar,
  firstFreeAvatar,
  GuestJoinInput,
  JoinGroupInput,
  MAX_GROUP_MEMBERS,
  type AvatarChoice,
  type GuestJoinDTO,
  type InvitePreviewDTO,
} from '@squadsplit/shared'
import { hasMembership } from '../access'
import { activeMemberAvatars, avatarColumns, ensureAvatarFree, storingLook } from '../avatars'
import { signedInUser } from '../clerkAuth'
import { db, type Db } from '../db'
import { groups, memberships } from '../db/schema'
import type { AuthDeps } from '../deps'
import type { AppEnv } from '../env'
import { HttpError, isUniqueViolation, parseBody, parseOptionalBody } from '../errors'
import { groupDTO } from '../groupView'
import { claimAsGuest, joinAsNewGuest } from '../guests/join'
import { takeGuestJoin } from '../guests/joinLimit'
import { hashGuestToken, newGuestToken } from '../guests/token'
import { alreadyClaimed, alreadyInGroup, groupFull } from '../membershipErrors'
import { claimableIn, moveMember, unclaimedNames } from '../placeholders'
import { profileAvatarOf } from '../users'

// Bytes at or above the largest multiple of the alphabet size are skipped, so every character is equally likely.
const UNBIASED_BYTE_LIMIT = 256 - (256 % ALPHABET.length)
const MAX_CODE_ATTEMPTS = 4 // the first try plus up to 3 retries on a collision

export function newInviteCode(): string {
  let code = ''
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (byte < UNBIASED_BYTE_LIMIT && code.length < CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length]
    }
  }
  return code
}

const isInviteCodeCollision = (err: unknown) => isUniqueViolation(err, 'groups.invite_code')

/** Runs `write` with a new invite code, retrying with another code if it collides with an existing group's. */
export async function withFreshInviteCode<T>(write: (inviteCode: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write(newInviteCode())
    } catch (err) {
      if (attempt >= MAX_CODE_ATTEMPTS || !isInviteCodeCollision(err)) throw err
    }
  }
}

/** Codes are shown in upper case; accept them typed in any case. 404 for an unknown or reset code. */
async function groupByInviteCode(d: Db, code: string) {
  const group = await d
    .select({ id: groups.id, name: groups.name, emoji: groups.emoji })
    .from(groups)
    .where(eq(groups.inviteCode, code.toUpperCase()))
    .get()
  if (!group) throw new HttpError(404, 'not_found', 'Invite not found')
  return group
}

/** The avatar a former member left with (their default if they never had one stored), or null for anyone else. */
async function formerAvatar(d: Db, groupId: string, userId: string) {
  const row = await d
    .select({ animal: memberships.avatarAnimal, color: memberships.avatarColor })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId), isNotNull(memberships.leftAt)))
    .get()
  return row ? effectiveAvatar(userId, row) : null
}

export const isMembershipCollision = (err: unknown) => isUniqueViolation(err, 'memberships.group_id, memberships.user_id')

/**
 * Joining as one of the group's unclaimed names (a placeholder, or a signed-out guest): you take its place, history
 * and look (unless you picked another), and its name becomes your nickname (unless you sent one). 409 for someone
 * who has been in the group before, or for a name that isn't one of this group's unclaimed names.
 */
async function claim(
  d: Db,
  groupId: string,
  me: string,
  placeholderId: string,
  input: { avatar?: AvatarChoice; nickname?: string | null },
) {
  if (await hasMembership(d, groupId, me)) throw alreadyInGroup()
  const placeholder = (await unclaimedNames(d, groupId)).find((p) => p.userId === placeholderId)
  if (!placeholder) throw alreadyClaimed()
  const members = await activeMemberAvatars(d, groupId)
  // Read separately from the names above, so someone may have claimed it in between.
  const placeholderLook = members.find((m) => m.userId === placeholderId)?.avatar
  if (!placeholderLook) throw alreadyClaimed()
  const avatar = input.avatar ?? placeholderLook
  if (input.avatar) ensureAvatarFree(input.avatar, members.filter((m) => m.userId !== placeholderId).map((m) => m.avatar))

  const statements = moveMember(d, {
    groupId,
    from: placeholderId,
    to: me,
    onlyIf: claimableIn(groupId, placeholderId),
    membership: {
      joinedAt: new Date().toISOString(),
      avatar,
      nickname: input.nickname !== undefined ? input.nickname : placeholder.name,
    },
  })
  let moved: { userId: string }[]
  try {
    ;[moved] = await storingLook(d.batch(statements))
  } catch (err) {
    // You joined the group some other way at the same moment.
    if (isMembershipCollision(err)) throw alreadyInGroup()
    throw err
  }
  if (moved.length === 0) throw alreadyClaimed()
}

/**
 * The invite routes anyone with the link may use, with no sign-in (mounted before authentication): the preview, and
 * joining as a guest. The preview still knows a signed-in caller.
 */
export function publicInviteRoutes(deps: AuthDeps) {
  return new Hono<AppEnv>()
    .get('/:code', async (c) => {
      const d = db(c.env)
      const group = await groupByInviteCode(d, c.req.param('code'))
      const members = await activeMemberAvatars(d, group.id)
      const me = await signedInUser(deps, c)
      return c.json<InvitePreviewDTO>({
        groupId: group.id,
        name: group.name,
        emoji: group.emoji,
        memberCount: members.length,
        alreadyMember: me !== null && members.some((m) => m.userId === me),
        takenAvatars: members.map((m) => m.avatar),
        myFormerAvatar: me === null ? null : await formerAvatar(d, group.id, me),
        // Read after the members, so a name added in between has no look here yet: it shows on the next preview.
        placeholders: (await unclaimedNames(d, group.id)).flatMap((p) => {
          const avatar = members.find((m) => m.userId === p.userId)?.avatar
          return avatar ? [{ ...p, avatar }] : []
        }),
      })
    })

    // Joining with no account, as one of the group's unclaimed names or as someone new. The phone gets a token
    // for this group alone. Every attempt counts towards the group's hourly limit.
    .post('/:code/guest', async (c) => {
      const d = db(c.env)
      const group = await groupByInviteCode(d, c.req.param('code'))
      const { claim: nameId, name, ...look } = await parseBody(c, GuestJoinInput)
      if (!(await takeGuestJoin(c.env.DB, group.id))) {
        throw new HttpError(429, 'slow_down', 'Lots of people joining this group just now. Try again in a little while.')
      }
      const token = newGuestToken()
      const tokenHash = await hashGuestToken(token)
      const now = new Date().toISOString()
      const guestId =
        nameId !== undefined
          ? await claimAsGuest(d, group.id, nameId, look, tokenHash, now)
          : await joinAsNewGuest(d, group.id, name!, look, tokenHash, now)
      const member = (await groupDTO(d, group.id)).members.find((m) => m.userId === guestId)!
      return c.json<GuestJoinDTO>({ token, groupId: group.id, member }, 201)
    })
}

/** Joining with an account (signed in). */
export function inviteRoutes() {
  return new Hono<AppEnv>()
    .post('/:code/join', async (c) => {
      const d = db(c.env)
      const me = c.var.userId
      const group = await groupByInviteCode(d, c.req.param('code'))
      const { claim: placeholderId, ...input } = await parseOptionalBody(c, JoinGroupInput)
      if (placeholderId !== undefined) {
        await claim(d, group.id, me, placeholderId, input)
        return c.json({ groupId: group.id })
      }
      const members = await activeMemberAvatars(d, group.id)
      // Already in: nothing changes, not even the avatar.
      if (members.some((m) => m.userId === me)) return c.json({ groupId: group.id })
      if (members.length >= MAX_GROUP_MEMBERS) throw groupFull()
      const taken = members.map((m) => m.avatar)
      let avatar = input.avatar
      if (avatar) ensureAvatarFree(avatar, taken)
      // No choice: a former member's old look, else their profile look, moved on to a free one if it's taken.
      else avatar = firstFreeAvatar((await formerAvatar(d, group.id, me)) ?? (await profileAvatarOf(d, me)), taken)

      const now = new Date().toISOString()
      // New: insert as a member. Former member: reactivate (role unchanged). Current member: no-op.
      // The row is only written while the group has room, checked in the same statement, so people joining at
      // the same moment can't take it past the cap. Columns in table order: group, user, role, joined, left,
      // animal, colour, nickname.
      const written = await storingLook(
        d
          .insert(memberships)
          .select(
            sql`SELECT ${group.id}, ${me}, 'member', ${now}, NULL, ${avatar.animal}, ${avatar.color}, ${input.nickname ?? null}
                WHERE (SELECT COUNT(*) FROM ${memberships} WHERE ${memberships.groupId} = ${group.id} AND ${memberships.leftAt} IS NULL) < ${MAX_GROUP_MEMBERS}`,
          )
          .onConflictDoUpdate({
            target: [memberships.groupId, memberships.userId],
            // A former member keeps their old nickname unless they sent a new one.
            set: { joinedAt: now, leftAt: null, ...avatarColumns(avatar), ...(input.nickname !== undefined && { nickname: input.nickname }) },
            setWhere: isNotNull(memberships.leftAt),
          })
          .returning({ userId: memberships.userId }),
      )
      // Nothing written: the group filled up, unless this same caller joined in the meantime.
      if (written.length === 0 && !(await activeMemberAvatars(d, group.id)).some((m) => m.userId === me)) throw groupFull()
      return c.json({ groupId: group.id })
    })
}
