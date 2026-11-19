import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  defaultAvatar,
  firstFreeAvatar,
  MAX_GROUP_MEMBERS,
  type ApiErrorBody,
  type BalancesDTO,
  type FeedItem,
  type FunDTO,
  type GroupDTO,
  type InvitePreviewDTO,
  type MemberDTO,
  type SettlementDTO,
} from '@squadsplit/shared'
import {
  expenseItemUsers,
  expenseItems,
  expenseShares,
  expenses,
  memberships,
  settlements,
  spins,
  users,
} from '../src/db/schema'
import { db, json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
type Send = typeof alice

async function errorCode(res: Response) {
  return ((await res.json()) as ApiErrorBody).error.code
}

async function createGroup(members?: string[], as: Send = alice) {
  const res = await as('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️', ...(members && { members }) }))
  expect(res.status).toBe(201)
  return (await res.json()) as GroupDTO & { inviteCode: string }
}

const placeholdersOf = (g: GroupDTO) => g.members.filter((m) => m.placeholder)
const idOf = (g: GroupDTO, name: string) => g.members.find((m) => m.displayName === name)!.userId

async function getGroup(id: string, as: Send = alice) {
  const res = await as(`/groups/${id}`)
  expect(res.status).toBe(200)
  return (await res.json()) as GroupDTO
}

const addName = (groupId: string, name: string, as: Send = alice) => as(`/groups/${groupId}/placeholders`, json('POST', { name }))
const join = (as: Send, code: string, body: object = {}) => as(`/invites/${code}/join`, json('POST', body))
const preview = async (as: Send, code: string) => (await (await as(`/invites/${code}`)).json()) as InvitePreviewDTO

const expense = (groupId: string, body: object, as: Send = alice) =>
  as(
    `/groups/${groupId}/expenses`,
    json('POST', { description: 'Dinner', category: '🍕', spentOn: '2026-11-19', ...body }),
  )

async function balances(groupId: string, as: Send = alice) {
  return ((await (await as(`/groups/${groupId}/balances`)).json()) as BalancesDTO).balances
}

describe('POST /groups with names', () => {
  it('adds each name as a placeholder member with a unique look, in the order typed, after the owner', async () => {
    const group = await createGroup(['  Dave ', 'Erin'])

    expect(group.members.map((m) => [m.displayName, m.role, m.placeholder, m.active])).toEqual([
      ['User alice', 'owner', false, true],
      ['Dave', 'member', true, true],
      ['Erin', 'member', true, true],
    ])
    const [owner, dave, erin] = group.members as [MemberDTO, MemberDTO, MemberDTO]
    expect(dave.userId).toMatch(/^ph_[0-9a-f-]{36}$/)
    expect(dave.avatar).toEqual(firstFreeAvatar(defaultAvatar(dave.userId), [owner.avatar]))
    expect(erin.avatar).toEqual(firstFreeAvatar(defaultAvatar(erin.userId), [owner.avatar, dave.avatar]))

    const rows = await db().select().from(users).where(eq(users.id, dave.userId))
    expect(rows).toMatchObject([{ displayName: 'Dave', kind: 'placeholder' }])
  })

  it('creates a group of 12 with 11 names, and the 12-person cap then counts the names', async () => {
    const group = await createGroup(Array.from({ length: MAX_GROUP_MEMBERS - 1 }, (_, i) => `P${i}`))
    expect(group.members).toHaveLength(MAX_GROUP_MEMBERS)

    expect(await errorCode(await join(bob, group.inviteCode))).toBe('group_full')
    expect(await errorCode(await addName(group.id, 'One more'))).toBe('group_full')
  })

  it('rejects a 12th name and invalid names with 422, creating nothing', async () => {
    const tooMany = await alice('/groups', json('POST', { name: 'X', emoji: '🏝️', members: Array.from({ length: 12 }, (_, i) => `P${i}`) }))
    expect(tooMany.status).toBe(422)
    const emoji = await alice('/groups', json('POST', { name: 'X', emoji: '🏝️', members: ['Dave 🍕'] }))
    expect(emoji.status).toBe(422)
    expect(await db().select().from(users).where(eq(users.kind, 'placeholder'))).toEqual([])
  })
})

describe('POST /groups/:id/placeholders', () => {
  it('lets the owner add a name, with a free look', async () => {
    const group = await createGroup()
    const res = await addName(group.id, ' Frank ')
    expect(res.status).toBe(201)
    const frank = (await res.json()) as MemberDTO
    expect(frank).toMatchObject({ displayName: 'Frank', nickname: null, role: 'member', active: true, placeholder: true })
    expect(frank.avatar).toEqual(firstFreeAvatar(defaultAvatar(frank.userId), [defaultAvatar('alice')]))
    expect(placeholdersOf(await getGroup(group.id))).toEqual([frank])
  })

  it('is 403 for a member who is not the owner, 404 for a non-member and 422 for a bad name', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    expect((await addName(group.id, 'Frank', bob)).status).toBe(403)
    expect((await addName(group.id, 'Frank', carol)).status).toBe(404)
    expect((await addName(group.id, '  ')).status).toBe(422)
  })

  it('is 409 group_full when the group already has 12 people, and leaves no stray placeholder behind', async () => {
    const group = await createGroup(Array.from({ length: MAX_GROUP_MEMBERS - 2 }, (_, i) => `P${i}`))
    expect((await addName(group.id, 'Last')).status).toBe(201)
    const before = await db().select().from(users).where(eq(users.kind, 'placeholder'))

    const res = await addName(group.id, 'Too many')

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('group_full')
    expect(await db().select().from(users).where(eq(users.kind, 'placeholder'))).toEqual(before)
  })
})

describe('DELETE /groups/:id/members/:placeholderId', () => {
  it('lets the owner remove a name nobody uses, deleting the placeholder entirely', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')

    expect((await alice(`/groups/${group.id}/members/${dave}`, { method: 'DELETE' })).status).toBe(204)

    expect((await getGroup(group.id)).members.map((m) => m.userId)).toEqual(['alice'])
    expect(await db().select().from(users).where(eq(users.id, dave))).toEqual([])
  })

  it('is 409 name_in_use once the name is in an expense, even at a zero balance', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    expect((await expense(group.id, { amountCents: 500, paidBy: dave, split: { type: 'equal', participantIds: [dave] } })).status).toBe(201)

    const res = await alice(`/groups/${group.id}/members/${dave}`, { method: 'DELETE' })

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('name_in_use')
    expect(placeholdersOf(await getGroup(group.id))).toHaveLength(1)
  })

  it('is 409 name_in_use once the wheel picked them', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    await db().insert(spins).values({ id: 's1', groupId: group.id, spunBy: 'alice', winnerId: dave, weightsJson: '{}', createdAt: new Date().toISOString() })
    expect(await errorCode(await alice(`/groups/${group.id}/members/${dave}`, { method: 'DELETE' }))).toBe('name_in_use')
  })

  it('is 403 for a member who is not the owner', async () => {
    const group = await createGroup(['Dave'])
    await join(bob, group.inviteCode)
    expect((await bob(`/groups/${group.id}/members/${idOf(group, 'Dave')}`, { method: 'DELETE' })).status).toBe(403)
  })
})

describe('placeholders in the money', () => {
  it('can pay, share, and appear in balances, the leaderboard and the wheel', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    const res = await expense(group.id, { amountCents: 1000, paidBy: dave, split: { type: 'equal', participantIds: ['alice', dave] } })
    expect(res.status).toBe(201)

    expect(await balances(group.id)).toEqual({ alice: -500, [dave]: 500 })
    const fun = (await (await alice(`/groups/${group.id}/badges`)).json()) as FunDTO
    expect(fun.leaderboard.map((e) => e.userId)).toEqual([dave, 'alice'])
    const spin = await alice(`/groups/${group.id}/spins`, { method: 'POST' })
    expect(spin.status).toBe(201)
  })

  it('leaves placeholders out of the feed’s joins', async () => {
    const group = await createGroup(['Dave'])
    const feed = (await (await alice(`/groups/${group.id}/feed`)).json()) as FeedItem[]
    expect(feed.filter((i) => i.type === 'join').map((i) => (i as { userId: string }).userId)).toEqual(['alice'])
  })
})

describe('settling with someone who has not joined', () => {
  /** Dave and Erin haven't joined. `daveOwesAlice`: Alice paid 1000 for herself and Dave, so Dave owes her 500.
   *  Otherwise Erin paid 600 for herself and Alice, so Alice owes Erin 300. */
  async function squad(daveOwesAlice: boolean) {
    const group = await createGroup(['Dave', 'Erin'])
    const dave = idOf(group, 'Dave')
    const erin = idOf(group, 'Erin')
    const res = daveOwesAlice
      ? await expense(group.id, { amountCents: 1000, paidBy: 'alice', split: { type: 'equal', participantIds: ['alice', dave] } })
      : await expense(group.id, { amountCents: 600, paidBy: erin, split: { type: 'equal', participantIds: ['alice', erin] } })
    expect(res.status).toBe(201)
    return { group, dave, erin }
  }
  const settle = (groupId: string, body: object, as: Send = alice) => as(`/groups/${groupId}/settlements`, json('POST', body))

  it('confirms straight away when you pay a placeholder', async () => {
    const { group, erin } = await squad(false)

    const res = await settle(group.id, { toUserId: erin, amountCents: 300 })

    expect(res.status).toBe(201)
    const s = (await res.json()) as SettlementDTO
    expect(s).toMatchObject({ fromUserId: 'alice', toUserId: erin, amountCents: 300, status: 'confirmed', resolvedAt: expect.any(String) })
    expect((await balances(group.id))[erin]).toBe(0)
  })

  it('lets the creditor record that a placeholder paid them, confirmed straight away', async () => {
    const { group, dave } = await squad(true)

    const res = await settle(group.id, { fromUserId: dave, toUserId: 'alice', amountCents: 500 })

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ fromUserId: dave, toUserId: 'alice', status: 'confirmed' })
    expect((await balances(group.id))[dave]).toBe(0)
  })

  it('caps what a placeholder can be recorded as paying at their debt', async () => {
    const { group, dave } = await squad(true)
    const res = await settle(group.id, { fromUserId: dave, toUserId: 'alice', amountCents: 501 })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('exceeds_debt')
  })

  it('caps what you pay a placeholder at their credit', async () => {
    const { group, erin } = await squad(false)
    expect(await errorCode(await settle(group.id, { toUserId: erin, amountCents: 301 }))).toBe('exceeds_debt')
  })

  it('refuses placeholder to placeholder (422)', async () => {
    const { group, dave, erin } = await squad(true)
    const res = await settle(group.id, { fromUserId: dave, toUserId: erin, amountCents: 100 })
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('placeholder_to_placeholder')
  })

  it('refuses recording a payment from a real person, or to someone other than you (422)', async () => {
    const { group, dave } = await squad(true)
    await join(bob, group.inviteCode)
    expect(await errorCode(await settle(group.id, { fromUserId: 'bob', toUserId: 'alice', amountCents: 1 }))).toBe('not_your_payment')
    expect(await errorCode(await settle(group.id, { fromUserId: dave, toUserId: 'bob', amountCents: 1 }))).toBe('not_your_payment')
  })

  it('still lets you name yourself as the payer', async () => {
    const { group, erin } = await squad(false)
    expect((await settle(group.id, { fromUserId: 'alice', toUserId: erin, amountCents: 100 })).status).toBe(201)
  })
})

describe('GET /invites/:code placeholders', () => {
  it('lists the unclaimed names with their looks, and counts them as members', async () => {
    const group = await createGroup(['Dave'])
    const dave = group.members[1]!

    const p = await preview(bob, group.inviteCode)

    expect(p.placeholders).toEqual([{ userId: dave.userId, name: 'Dave', avatar: dave.avatar }])
    expect(p.memberCount).toBe(2)
    expect(p.takenAvatars).toEqual([group.members[0]!.avatar, dave.avatar])
  })
})

describe('POST /invites/:code/join with claim', () => {
  /** Dave (a placeholder) is in every kind of record: an itemized expense he paid, shares, a settlement and a spin. */
  async function daveEverywhere() {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    const res = await expense(group.id, {
      amountCents: 1000,
      paidBy: dave,
      split: { type: 'itemized', serviceChargeBps: 0, gstBps: 0, items: [{ name: 'Pizza', amountCents: 1000, userIds: ['alice', dave] }] },
    })
    expect(res.status).toBe(201)
    expect((await alice(`/groups/${group.id}/settlements`, json('POST', { toUserId: dave, amountCents: 200 }))).status).toBe(201)
    await db().insert(spins).values({ id: 'w1', groupId: group.id, spunBy: 'alice', winnerId: dave, weightsJson: '{}', createdAt: new Date().toISOString() })
    return { group, dave, daveAvatar: group.members[1]!.avatar }
  }

  it('makes the caller that person everywhere, keeps the look and the name, and deletes the placeholder', async () => {
    const { group, dave, daveAvatar } = await daveEverywhere()
    const before = await balances(group.id)

    const res = await join(bob, group.inviteCode, { claim: dave })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ groupId: group.id })
    const g = await getGroup(group.id, bob)
    expect(g.members.find((m) => m.userId === 'bob')).toMatchObject({
      displayName: 'Dave', nickname: 'Dave', placeholder: false, active: true, role: 'member', avatar: daveAvatar,
    })
    expect(g.members.some((m) => m.userId === dave)).toBe(false)
    expect(await balances(group.id)).toEqual({ alice: before.alice, bob: before[dave] })

    const d = db()
    expect(await d.select({ paidBy: expenses.paidBy }).from(expenses)).toEqual([{ paidBy: 'bob' }])
    expect((await d.select({ u: expenseShares.userId }).from(expenseShares)).map((r) => r.u).sort()).toEqual(['alice', 'bob'])
    expect((await d.select({ u: expenseItemUsers.userId }).from(expenseItemUsers).innerJoin(expenseItems, eq(expenseItems.id, expenseItemUsers.itemId))).map((r) => r.u).sort()).toEqual(['alice', 'bob'])
    expect(await d.select({ to: settlements.toUserId }).from(settlements)).toEqual([{ to: 'bob' }])
    expect(await d.select({ w: spins.winnerId }).from(spins)).toEqual([{ w: 'bob' }])
    expect(await d.select().from(users).where(eq(users.id, dave))).toEqual([])
    expect((await preview(carol, group.inviteCode)).placeholders).toEqual([])
  })

  it('uses the nickname and look the caller sent instead', async () => {
    const { group, dave } = await daveEverywhere()
    const look = { animal: 'penguin', color: 'lemon' } as const
    expect((await join(bob, group.inviteCode, { claim: dave, nickname: 'Bobby', avatar: look })).status).toBe(200)
    expect((await getGroup(group.id, bob)).members.find((m) => m.userId === 'bob')).toMatchObject({ displayName: 'Bobby', avatar: look })
  })

  it('works in a full group, since it takes the name’s place', async () => {
    const group = await createGroup(Array.from({ length: MAX_GROUP_MEMBERS - 1 }, (_, i) => `P${i}`))
    expect((await join(bob, group.inviteCode, { claim: idOf(group, 'P3') })).status).toBe(200)
    expect((await getGroup(group.id, bob)).members).toHaveLength(MAX_GROUP_MEMBERS)
  })

  it('is 409 already_claimed for a name someone else claimed first', async () => {
    const { group, dave } = await daveEverywhere()
    expect((await join(bob, group.inviteCode, { claim: dave })).status).toBe(200)
    const res = await join(carol, group.inviteCode, { claim: dave })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('already_claimed')
  })

  it('is 409 already_claimed for an id that is not one of this group’s names', async () => {
    const group = await createGroup(['Dave'])
    const other = await createGroup(['Zed'], carol)
    expect(await errorCode(await join(bob, group.inviteCode, { claim: idOf(other, 'Zed') }))).toBe('already_claimed')
    expect(await errorCode(await join(bob, group.inviteCode, { claim: 'alice' }))).toBe('already_claimed')
  })

  it('is 409 already_in_group for a current or former member, changing nothing', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    await join(bob, group.inviteCode)
    expect(await errorCode(await join(bob, group.inviteCode, { claim: dave }))).toBe('already_in_group')

    await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
    expect(await errorCode(await join(bob, group.inviteCode, { claim: dave }))).toBe('already_in_group')
    expect(placeholdersOf(await getGroup(group.id))).toHaveLength(1)
    const row = await db().select().from(memberships).where(and(eq(memberships.groupId, group.id), eq(memberships.userId, 'bob')))
    expect(row[0]?.leftAt).not.toBeNull()
  })

  it('is 409 avatar_taken for a look someone else in the group has', async () => {
    const group = await createGroup(['Dave'])
    const res = await join(bob, group.inviteCode, { claim: idOf(group, 'Dave'), avatar: defaultAvatar('alice') })
    expect(await errorCode(res)).toBe('avatar_taken')
  })
})

describe('placeholder ids are never a signed-in user', () => {
  it('rejects a token for a ph_ id', async () => {
    const group = await createGroup(['Dave'])
    const res = await app.as(idOf(group, 'Dave'))(`/groups/${group.id}`)
    expect(res.status).toBe(401)
    expect((await app.as('ph_anything')('/me')).status).toBe(401)
  })
})
