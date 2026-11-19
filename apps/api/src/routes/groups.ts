import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  computeBalances,
  CreateGroupInput,
  defaultAvatar,
  effectiveAvatar,
  UpdateGroupInput,
  UpdateMemberInput,
  type Currency,
  type GroupDTO,
  type GroupSummaryDTO,
  type MemberDTO,
} from '@squadsplit/shared'
import { activeMemberAvatars, avatarColumns, distinctLooks, ensureAvatarFree, storingLook } from '../avatars'
import { findActiveRole, requireMember, requireOwner } from '../access'
import { db, type Db } from '../db'
import { loadLedger } from '../db/ledger'
import { expenses, groups, memberships, settlements, users } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError, parseBody } from '../errors'
import { withFreshInviteCode } from './invites'

async function balanceOf(d: Db, groupId: string, userId: string): Promise<number> {
  return computeBalances(await loadLedger(d, groupId))[userId] ?? 0
}

/** Whether a settlement in the group is still pending with the user as debtor or creditor. */
async function hasPendingSettlement(d: Db, groupId: string, userId: string): Promise<boolean> {
  const pending = await d
    .select({ id: settlements.id })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        eq(settlements.status, 'pending'),
        or(eq(settlements.fromUserId, userId), eq(settlements.toUserId, userId)),
      ),
    )
    .limit(1)
    .get()
  return pending !== undefined
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The group as `viewerId` sees it: the invite code is for the owner's eyes only. */
async function groupDTO(d: Db, groupId: string, viewerId: string): Promise<GroupDTO> {
  const [[group], members] = await d.batch([
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
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.groupId, groupId))
      // Owner first (false sorts before true), then by join time.
      .orderBy(sql`${memberships.role} <> 'owner'`, asc(memberships.joinedAt), asc(memberships.userId)),
  ])
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
    inviteCode: viewerId === group.ownerId ? group.inviteCode : null,
    ownerId: group.ownerId,
    members: members.map(({ profileName, joinedAt: _joinedAt, leftAt, avatarAnimal, avatarColor, ...m }) => ({
      ...m,
      displayName: m.nickname ?? profileName,
      active: leftAt === null,
      avatar: shown.get(m.userId) ?? effectiveAvatar(m.userId, { animal: avatarAnimal, color: avatarColor }),
    })),
  }
}

export function groupRoutes() {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const d = db(c.env)
      const me = c.var.userId
      const rows = await d
        .select({ id: groups.id, name: groups.name, emoji: groups.emoji, currency: groups.currency, role: memberships.role })
        .from(memberships)
        .innerJoin(groups, eq(groups.id, memberships.groupId))
        .where(and(eq(memberships.userId, me), isNull(memberships.leftAt)))
        .orderBy(desc(groups.createdAt), asc(groups.id))
      const summaries = await Promise.all(
        rows.map(async (g): Promise<GroupSummaryDTO> => ({
          ...g,
          currency: g.currency as Currency,
          myBalanceCents: await balanceOf(d, g.id, me),
        })),
      )
      return c.json(summaries)
    })

    .post('/', async (c) => {
      const d = db(c.env)
      const me = c.var.userId
      const { nickname, ...input } = await parseBody(c, CreateGroupInput)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await withFreshInviteCode((inviteCode) =>
        d.batch([
          d.insert(groups).values({ id, ...input, inviteCode, ownerId: me, createdAt: now }),
          d.insert(memberships).values({ groupId: id, userId: me, role: 'owner', joinedAt: now, nickname, ...avatarColumns(defaultAvatar(me)) }),
        ]),
      )
      return c.json(await groupDTO(d, id, me), 201)
    })

    .get('/:id', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      return c.json(await groupDTO(d, groupId, c.var.userId))
    })

    .patch('/:id', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireOwner(d, groupId, c.var.userId)
      const input = await parseBody(c, UpdateGroupInput)
      if (input.currency !== undefined) {
        const [[group], [anyExpense]] = await d.batch([
          d.select({ currency: groups.currency }).from(groups).where(eq(groups.id, groupId)).limit(1),
          d.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId)).limit(1),
        ])
        if (anyExpense && group?.currency !== input.currency) {
          throw new HttpError(409, 'currency_locked', "The currency can't change once the group has an expense")
        }
      }
      await d.update(groups).set(input).where(eq(groups.id, groupId))
      return c.json(await groupDTO(d, groupId, c.var.userId))
    })

    .post('/:id/invite/reset', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireOwner(d, groupId, c.var.userId)
      const inviteCode = await withFreshInviteCode(async (code) => {
        await d.update(groups).set({ inviteCode: code }).where(eq(groups.id, groupId))
        return code
      })
      return c.json({ inviteCode })
    })

    // The caller's nickname and look in this group. The avatar must differ from every other active member's.
    .patch('/:id/members/me', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const me = c.var.userId
      await requireMember(d, groupId, me)
      const { avatar, nickname } = await parseBody(c, UpdateMemberInput)
      if (avatar) {
        const others = (await activeMemberAvatars(d, groupId)).filter((m) => m.userId !== me)
        ensureAvatarFree(avatar, others.map((m) => m.avatar))
      }
      await storingLook(
        d
          .update(memberships)
          .set({ ...(avatar && avatarColumns(avatar)), ...(nickname !== undefined && { nickname }) })
          .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, me))),
      )
      const group = await groupDTO(d, groupId, me)
      return c.json<MemberDTO>(group.members.find((m) => m.userId === me)!)
    })

    // Leaving (the caller removes themselves) or removing (the owner removes someone else).
    .delete('/:id/members/:userId', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const targetId = c.req.param('userId')
      const me = c.var.userId
      if (targetId === me) await requireMember(d, groupId, me)
      else await requireOwner(d, groupId, me)

      const targetRole = await findActiveRole(d, groupId, targetId)
      if (!targetRole) throw new HttpError(404, 'not_found', 'Member not found')
      if (targetRole === 'owner') throw new HttpError(409, 'owner_cannot_leave', "The owner can't leave the group")
      if ((await balanceOf(d, groupId, targetId)) !== 0) {
        throw new HttpError(409, 'balance_not_zero', 'Only a member whose balance is exactly 0 can leave the group')
      }
      if (await hasPendingSettlement(d, groupId, targetId)) {
        throw new HttpError(409, 'pending_settlement', 'Confirm, reject or cancel pending settlements before leaving the group')
      }

      await d
        .update(memberships)
        .set({ leftAt: new Date().toISOString() })
        .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId)))
      return c.body(null, 204)
    })
}
