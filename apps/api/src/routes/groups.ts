import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  computeBalances,
  CreateGroupInput,
  UpdateGroupInput,
  type Currency,
  type GroupDTO,
  type GroupSummaryDTO,
} from '@squadsplit/shared'
import { findActiveRole, requireMember, requireOwner } from '../access'
import { db, type Db } from '../db'
import { loadLedger } from '../db/ledger'
import { expenses, groups, memberships, users } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError, parseBody } from '../errors'
import { withFreshInviteCode } from './invites'

async function balanceOf(d: Db, groupId: string, userId: string): Promise<number> {
  return computeBalances(await loadLedger(d, groupId))[userId] ?? 0
}

/** The group as `viewerId` sees it: the invite code is for the owner's eyes only. */
async function groupDTO(d: Db, groupId: string, viewerId: string): Promise<GroupDTO> {
  const [[group], members] = await d.batch([
    d.select().from(groups).where(eq(groups.id, groupId)).limit(1),
    d
      .select({
        userId: memberships.userId,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: memberships.role,
        leftAt: memberships.leftAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.groupId, groupId))
      // Owner first (false sorts before true), then by join time.
      .orderBy(sql`${memberships.role} <> 'owner'`, asc(memberships.joinedAt), asc(memberships.userId)),
  ])
  if (!group) throw new HttpError(404, 'not_found', 'Group not found')
  return {
    id: group.id,
    name: group.name,
    emoji: group.emoji,
    currency: group.currency as Currency,
    inviteCode: viewerId === group.ownerId ? group.inviteCode : null,
    ownerId: group.ownerId,
    members: members.map(({ leftAt, ...m }) => ({ ...m, active: leftAt === null })),
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
      const input = await parseBody(c, CreateGroupInput)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await withFreshInviteCode((inviteCode) =>
        d.batch([
          d.insert(groups).values({ id, ...input, inviteCode, ownerId: me, createdAt: now }),
          d.insert(memberships).values({ groupId: id, userId: me, role: 'owner', joinedAt: now }),
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

      await d
        .update(memberships)
        .set({ leftAt: new Date().toISOString() })
        .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId)))
      return c.body(null, 204)
    })
}
