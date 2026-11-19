import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  AddPlaceholderInput,
  computeBalances,
  CreateGroupInput,
  MAX_GROUP_MEMBERS,
  UpdateGroupInput,
  UpdateMemberInput,
  type Currency,
  type GroupDTO,
  type GroupSummaryDTO,
  type MemberDTO,
} from '@squadsplit/shared'
import { activeMemberAvatars, avatarColumns, ensureAvatarFree, storingLook } from '../avatars'
import { findActiveRole, hasMembership, requireMember, requireOwner } from '../access'
import { db, type Db } from '../db'
import { loadLedger } from '../db/ledger'
import { expenses, groups, guestSessions, memberships, settlements, users } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError, isForeignKeyViolation, parseBody } from '../errors'
import { groupDTO } from '../groupView'
import { resetGuestJoins } from '../guests/joinLimit'
import { endGroupSessions, endGuestSessions } from '../guests/sessions'
import { alreadyInGroup, groupFull } from '../membershipErrors'
import {
  deletePlaceholder,
  insertNameIfRoom,
  insertPlaceholder,
  isNameOnly,
  moveMember,
  newPlaceholders,
  placeholderInUse,
} from '../placeholders'
import { profileAvatarOf } from '../users'
import { isMembershipCollision, withFreshInviteCode } from './invites'

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
      const { nickname, members: names = [], ...input } = await parseBody(c, CreateGroupInput)
      const id = crypto.randomUUID()
      const created = Date.now()
      const now = new Date(created).toISOString()
      // You start on your profile look; everyone you name gets a free look of their own.
      const ownerAvatar = await profileAvatarOf(d, me)
      const placeholders = newPlaceholders(names, [ownerAvatar])
      await withFreshInviteCode((inviteCode) =>
        d.batch([
          d.insert(groups).values({ id, ...input, inviteCode, ownerId: me, createdAt: now }),
          d.insert(memberships).values({ groupId: id, userId: me, role: 'owner', joinedAt: now, nickname, ...avatarColumns(ownerAvatar) }),
          // A millisecond apart, so the group lists them in the order they were typed.
          ...placeholders.flatMap((p, i) => insertPlaceholder(d, id, p, new Date(created + i + 1).toISOString())),
        ]),
      )
      return c.json(await groupDTO(d, id), 201)
    })

    .get('/:id', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      return c.json(await groupDTO(d, groupId))
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
      return c.json(await groupDTO(d, groupId))
    })

    .post('/:id/invite/reset', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireOwner(d, groupId, c.var.userId)
      // The new link signs every guest out on every phone: they rejoin with it and pick their name again. The hourly
      // join count starts afresh, so attempts on the old link can't hold them up.
      const inviteCode = await withFreshInviteCode(async (code) => {
        await d.batch([
          d.update(groups).set({ inviteCode: code }).where(eq(groups.id, groupId)),
          endGroupSessions(d, groupId),
          resetGuestJoins(d, groupId),
        ])
        return code
      })
      return c.json({ inviteCode })
    })

    // The owner adds someone who hasn't joined yet, by name. They count towards the cap like anyone else.
    .post('/:id/placeholders', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const me = c.var.userId
      await requireOwner(d, groupId, me)
      const { name } = await parseBody(c, AddPlaceholderInput)
      const taken = (await activeMemberAvatars(d, groupId)).map((m) => m.avatar)
      if (taken.length >= MAX_GROUP_MEMBERS) throw groupFull()
      const [placeholder] = newPlaceholders([name], taken)
      const [, written] = await storingLook(d.batch(insertNameIfRoom(d, groupId, placeholder!, new Date().toISOString())))
      if (written.length === 0) throw groupFull()
      const group = await groupDTO(d, groupId)
      return c.json<MemberDTO>(group.members.find((m) => m.userId === placeholder!.id)!, 201)
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
      const group = await groupDTO(d, groupId)
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
      // A name (one nobody has claimed, or a guest's) is deleted outright, but only while nothing in the group's
      // history uses it. A guest's sessions go with it.
      if (await isNameOnly(d, targetId)) {
        const nameInUse = () =>
          new HttpError(409, 'name_in_use', "This name is already in the group's expenses or history, so it stays until they join and claim it.")
        if (await placeholderInUse(d, targetId)) throw nameInUse()
        try {
          await d.batch(deletePlaceholder(d, groupId, targetId))
        } catch (err) {
          // Something started using the name after the check: its rows still point at the placeholder.
          if (isForeignKeyViolation(err)) throw nameInUse()
          throw err
        }
        return c.body(null, 204)
      }
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

    // "Free up name" (the owner, for a guest's lost phone): signs that guest out on every phone. Their name, and
    // everything under it, stays in the group for whoever claims it next.
    .post('/:id/members/:userId/release', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const targetId = c.req.param('userId')
      await requireOwner(d, groupId, c.var.userId)
      const guest = await d
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId), isNull(memberships.leftAt), eq(users.kind, 'guest')))
        .get()
      if (!guest) throw new HttpError(404, 'not_found', 'Guest not found')
      await endGuestSessions(d, targetId)
      return c.body(null, 204)
    })

    // Saving a guest to an account: the request carries both (see app.ts), and the account takes the guest's place
    // and history. The guest's id and sessions go; the phone keeps the group through the account.
    .post('/:id/guest/upgrade', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const me = c.var.userId
      const guest = c.var.guest
      if (!guest || guest.groupId !== groupId) throw new HttpError(404, 'not_found', 'Group not found')
      if (await hasMembership(d, groupId, me)) throw alreadyInGroup()
      const [member] = await d
        .select({ name: users.displayName, nickname: memberships.nickname })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, guest.userId)))
      if (!member) throw new HttpError(404, 'not_found', 'Group not found')

      const statements = moveMember(d, {
        groupId,
        from: guest.userId,
        to: me,
        // Still this request's guest: a reset in the meantime (and someone else claiming the name) stops the move.
        onlyIf: sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${guest.userId} AND ${users.kind} = 'guest')
          AND EXISTS (SELECT 1 FROM ${guestSessions} WHERE ${guestSessions.tokenHash} = ${guest.tokenHash})`,
        // The group keeps calling them what it did; their look and join day stay.
        membership: { nickname: member.nickname ?? member.name },
      })
      let moved: { userId: string }[]
      try {
        ;[moved] = await d.batch(statements)
      } catch (err) {
        // The account joined the group some other way at the same moment.
        if (isMembershipCollision(err)) throw alreadyInGroup()
        throw err
      }
      if (moved.length === 0) throw new HttpError(404, 'not_found', 'Group not found')
      return c.json<GroupDTO>(await groupDTO(d, groupId))
    })
}
