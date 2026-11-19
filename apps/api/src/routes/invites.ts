import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { InvitePreviewDTO } from '@squadsplit/shared'
import { db, type Db } from '../db'
import { groups, memberships } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError } from '../errors'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
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

function isInviteCodeCollision(err: unknown): boolean {
  // Drizzle wraps the D1 error, so walk the cause chain.
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes('UNIQUE constraint failed: groups.invite_code')) return true
  }
  return false
}

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

export function inviteRoutes() {
  return new Hono<AppEnv>()
    .get('/:code', async (c) => {
      const d = db(c.env)
      const group = await groupByInviteCode(d, c.req.param('code'))
      const members = await d
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.groupId, group.id), isNull(memberships.leftAt)))
      return c.json<InvitePreviewDTO>({
        groupId: group.id,
        name: group.name,
        emoji: group.emoji,
        memberCount: members.length,
        alreadyMember: members.some((m) => m.userId === c.var.userId),
      })
    })
    .post('/:code/join', async (c) => {
      const d = db(c.env)
      const group = await groupByInviteCode(d, c.req.param('code'))
      const now = new Date().toISOString()
      // New: insert as a member. Former member: reactivate (role unchanged). Current member: no-op.
      await d
        .insert(memberships)
        .values({ groupId: group.id, userId: c.var.userId, role: 'member', joinedAt: now })
        .onConflictDoUpdate({
          target: [memberships.groupId, memberships.userId],
          set: { joinedAt: now, leftAt: null },
          setWhere: isNotNull(memberships.leftAt),
        })
      return c.json({ groupId: group.id })
    })
}
