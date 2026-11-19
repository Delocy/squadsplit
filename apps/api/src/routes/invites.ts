import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  INVITE_CODE_ALPHABET as ALPHABET,
  INVITE_CODE_LENGTH as CODE_LENGTH,
  defaultAvatar,
  effectiveAvatar,
  firstFreeAvatar,
  JoinGroupInput,
  MAX_GROUP_MEMBERS,
  type InvitePreviewDTO,
} from '@squadsplit/shared'
import { activeMemberAvatars, avatarColumns, ensureAvatarFree, storingLook } from '../avatars'
import { db, type Db } from '../db'
import { groups, memberships } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError, isUniqueViolation, parseOptionalBody } from '../errors'

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

const groupFull = () => new HttpError(409, 'group_full', `This group is full (${MAX_GROUP_MEMBERS} people).`)

export function inviteRoutes() {
  return new Hono<AppEnv>()
    .get('/:code', async (c) => {
      const d = db(c.env)
      const group = await groupByInviteCode(d, c.req.param('code'))
      const members = await activeMemberAvatars(d, group.id)
      const me = c.var.userId
      return c.json<InvitePreviewDTO>({
        groupId: group.id,
        name: group.name,
        emoji: group.emoji,
        memberCount: members.length,
        alreadyMember: members.some((m) => m.userId === me),
        takenAvatars: members.map((m) => m.avatar),
        myFormerAvatar: await formerAvatar(d, group.id, me),
      })
    })
    .post('/:code/join', async (c) => {
      const d = db(c.env)
      const me = c.var.userId
      const group = await groupByInviteCode(d, c.req.param('code'))
      const input = await parseOptionalBody(c, JoinGroupInput)
      const members = await activeMemberAvatars(d, group.id)
      // Already in: nothing changes, not even the avatar.
      if (members.some((m) => m.userId === me)) return c.json({ groupId: group.id })
      if (members.length >= MAX_GROUP_MEMBERS) throw groupFull()
      const taken = members.map((m) => m.avatar)
      let avatar = input.avatar
      if (avatar) ensureAvatarFree(avatar, taken)
      // No choice: a former member's old look, else their default, moved on to a free one if it's taken.
      else avatar = firstFreeAvatar((await formerAvatar(d, group.id, me)) ?? defaultAvatar(me), taken)

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
