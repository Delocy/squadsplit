import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultAvatar, type ApiErrorBody, type GroupDTO, type GroupSummaryDTO } from '@squadsplit/shared'
import { loadLedger } from '../src/db/ledger'
import { expenseShares, expenses, groups, memberships, settlements, spins } from '../src/db/schema'
import { db, json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
type Send = typeof alice

const INVITE_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/

async function createGroup(as: Send = alice, input: object = { name: 'Bali trip', emoji: '🏝️' }) {
  const res = await as('/groups', json('POST', input))
  expect(res.status).toBe(201)
  return (await res.json()) as GroupDTO
}

/** Alice owns the group; bob has joined it. */
async function groupWithBob() {
  const group = await createGroup()
  expect((await bob(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
  return group
}

async function errorCode(res: Response) {
  return ((await res.json()) as ApiErrorBody).error.code
}

/** Inserts an expense paid by `paidBy`, split as `shares` (cents per user). */
async function seedExpense(groupId: string, paidBy: string, shares: Record<string, number>) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const amountCents = Object.values(shares).reduce((a, b) => a + b, 0)
  await db().insert(expenses).values({
    id, groupId, description: 'Dinner', amountCents, paidBy, createdBy: paidBy,
    category: '🍕', spentOn: '2026-11-19', splitType: 'exact', currency: 'SGD', createdAt: now, updatedAt: now,
  })
  await db().insert(expenseShares).values(Object.entries(shares).map(([userId, cents]) => ({ expenseId: id, userId, amountCents: cents })))
  return id
}

type SettlementStatus = (typeof settlements.$inferSelect)['status']

async function seedSettlement(groupId: string, fromUserId: string, toUserId: string, amountCents: number, status: SettlementStatus) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db().insert(settlements).values({
    id, groupId, fromUserId, toUserId, amountCents, status,
    createdAt: now, resolvedAt: status === 'pending' ? null : now,
  })
  return id
}

async function resolveSettlement(id: string, status: SettlementStatus) {
  await db().update(settlements).set({ status, resolvedAt: new Date().toISOString() }).where(eq(settlements.id, id))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /groups', () => {
  it('makes the caller the owner, defaults the currency to SGD and lists it in GET /groups', async () => {
    const group = await createGroup()

    expect(group).toMatchObject({ name: 'Bali trip', emoji: '🏝️', currency: 'SGD', ownerId: 'alice' })
    expect(group.inviteCode).toMatch(INVITE_CODE)
    expect(group.members).toEqual([
      { userId: 'alice', displayName: 'User alice', nickname: null, avatarUrl: null, role: 'owner', active: true, avatar: defaultAvatar('alice'), placeholder: false, guest: false },
    ])

    const list = await alice('/groups')
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual<GroupSummaryDTO[]>([
      { id: group.id, name: 'Bali trip', emoji: '🏝️', currency: 'SGD', role: 'owner', myBalanceCents: 0 },
    ])
  })

  it('rejects an invalid body with 422 validation_failed', async () => {
    const res = await alice('/groups', json('POST', { name: '', emoji: '🏝️' }))
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('validation_failed')
  })

  it('rejects a body that is not JSON with 422 validation_failed', async () => {
    const res = await alice('/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' })
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('validation_failed')
  })

  it('retries with a fresh invite code when the generated one is taken', async () => {
    const taken = await createGroup()
    // All-zero bytes map to 'AAAAAAAA'; make the next code collide with the existing group.
    await db().update(groups).set({ inviteCode: 'AAAAAAAA' }).where(eq(groups.id, taken.id))
    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((array) => {
      new Uint8Array(array.buffer).fill(0)
      return array
    })

    const group = await createGroup()

    expect(group.inviteCode).toMatch(INVITE_CODE)
    expect(group.inviteCode).not.toBe('AAAAAAAA')
  })
})

describe('GET /groups', () => {
  it('lists only active memberships, newest group first, with my balance', async () => {
    const older = await createGroup(alice, { name: 'Older', emoji: '🍜' })
    const newer = await createGroup(bob, { name: 'Newer', emoji: '🍣', currency: 'EUR' })
    const left = await createGroup(carol, { name: 'Left', emoji: '🚕' })
    await db().update(groups).set({ createdAt: '2026-01-01T00:00:00.000Z' }).where(eq(groups.id, older.id))
    await db().update(groups).set({ createdAt: '2026-02-01T00:00:00.000Z' }).where(eq(groups.id, newer.id))
    await alice(`/invites/${newer.inviteCode}/join`, { method: 'POST' })
    await alice(`/invites/${left.inviteCode}/join`, { method: 'POST' })
    expect((await alice(`/groups/${left.id}/members/alice`, { method: 'DELETE' })).status).toBe(204)
    await seedExpense(newer.id, 'bob', { bob: 300, alice: 700 })

    const res = await alice('/groups')

    expect(await res.json()).toEqual<GroupSummaryDTO[]>([
      { id: newer.id, name: 'Newer', emoji: '🍣', currency: 'EUR', role: 'member', myBalanceCents: -700 },
      { id: older.id, name: 'Older', emoji: '🍜', currency: 'SGD', role: 'owner', myBalanceCents: 0 },
    ])
  })
})

describe('GET /groups/:id', () => {
  it('is 404 for a non-member and for an unknown group', async () => {
    const group = await createGroup()

    const res = await carol(`/groups/${group.id}`)
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not_found')
    expect((await alice('/groups/no-such-group')).status).toBe(404)
  })

  it('shows the invite code to every member, so anyone in the group can share the link', async () => {
    const group = await groupWithBob()

    const asOwner = (await (await alice(`/groups/${group.id}`)).json()) as GroupDTO
    const asMember = (await (await bob(`/groups/${group.id}`)).json()) as GroupDTO

    expect(asOwner.inviteCode).toBe(group.inviteCode)
    expect(asMember.inviteCode).toBe(group.inviteCode)
  })

  it('shows the new code to members after the owner resets it', async () => {
    const group = await groupWithBob()
    const { inviteCode } = (await (await alice(`/groups/${group.id}/invite/reset`, { method: 'POST' })).json()) as { inviteCode: string }

    expect(((await (await bob(`/groups/${group.id}`)).json()) as GroupDTO).inviteCode).toBe(inviteCode)
  })

  it('lists the owner first, then by join time, keeping former members as inactive', async () => {
    const group = await createGroup(bob, { name: 'Bob trip', emoji: '🏕️' })
    await alice(`/invites/${group.inviteCode}/join`, { method: 'POST' })
    await carol(`/invites/${group.inviteCode}/join`, { method: 'POST' })
    await db().update(memberships).set({ joinedAt: '2000-01-01T00:00:00.000Z' }).where(eq(memberships.userId, 'carol'))
    await alice(`/groups/${group.id}/members/alice`, { method: 'DELETE' })

    const body = (await (await bob(`/groups/${group.id}`)).json()) as GroupDTO

    expect(body.members.map((m) => [m.userId, m.role, m.active])).toEqual([
      ['bob', 'owner', true],
      ['carol', 'member', true],
      ['alice', 'member', false],
    ])
  })
})

describe('PATCH /groups/:id', () => {
  it('is 404 for a non-member', async () => {
    const group = await createGroup()
    const res = await carol(`/groups/${group.id}`, json('PATCH', { name: 'Mine now' }))
    expect(res.status).toBe(404)
  })

  it('is 403 forbidden for a plain member', async () => {
    const group = await groupWithBob()
    const res = await bob(`/groups/${group.id}`, json('PATCH', { name: 'Bob rules' }))
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('forbidden')
  })

  it('lets the owner rename and change the currency before the first expense', async () => {
    const group = await createGroup()
    const res = await alice(`/groups/${group.id}`, json('PATCH', { name: 'Bali 2027', emoji: '🌴', currency: 'USD' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: group.id, name: 'Bali 2027', emoji: '🌴', currency: 'USD', inviteCode: group.inviteCode })
  })

  it('rejects an empty patch with 422', async () => {
    const group = await createGroup()
    const res = await alice(`/groups/${group.id}`, json('PATCH', {}))
    expect(res.status).toBe(422)
  })

  it('is 409 currency_locked once an expense exists, but other fields still change', async () => {
    const group = await createGroup()
    await seedExpense(group.id, 'alice', { alice: 100 })

    const res = await alice(`/groups/${group.id}`, json('PATCH', { currency: 'USD' }))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('currency_locked')

    const rename = await alice(`/groups/${group.id}`, json('PATCH', { name: 'Still SGD', currency: 'SGD' }))
    expect(rename.status).toBe(200)
    expect(await rename.json()).toMatchObject({ name: 'Still SGD', currency: 'SGD' })
  })
})

describe('POST /groups/:id/invite/reset', () => {
  it('is 404 for a non-member and 403 for a plain member', async () => {
    const group = await groupWithBob()
    expect((await carol(`/groups/${group.id}/invite/reset`, { method: 'POST' })).status).toBe(404)
    expect((await bob(`/groups/${group.id}/invite/reset`, { method: 'POST' })).status).toBe(403)
  })

  it('gives the owner a new code', async () => {
    const group = await createGroup()
    const res = await alice(`/groups/${group.id}/invite/reset`, { method: 'POST' })
    expect(res.status).toBe(200)
    const { inviteCode } = (await res.json()) as { inviteCode: string }
    expect(inviteCode).toMatch(INVITE_CODE)
    expect(inviteCode).not.toBe(group.inviteCode)
  })
})

describe('DELETE /groups/:id/members/:userId', () => {
  it('lets a member with a zero balance leave; they lose access and can rejoin', async () => {
    const group = await groupWithBob()

    const res = await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect((await bob(`/groups/${group.id}`)).status).toBe(404)
    expect(await (await bob('/groups')).json()).toEqual([])

    expect((await bob(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
    const body = (await (await bob(`/groups/${group.id}`)).json()) as GroupDTO
    expect(body.members.find((m) => m.userId === 'bob')).toMatchObject({ role: 'member', active: true })
  })

  it('is 409 balance_not_zero when the member leaving owes money', async () => {
    const group = await groupWithBob()
    await seedExpense(group.id, 'alice', { alice: 500, bob: 500 })

    const res = await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('balance_not_zero')
    expect((await bob(`/groups/${group.id}`)).status).toBe(200)
  })

  it('is 409 balance_not_zero when the owner removes a member who is owed money', async () => {
    const group = await groupWithBob()
    await seedExpense(group.id, 'bob', { alice: 500, bob: 500 })

    const res = await alice(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('balance_not_zero')
  })

  it('counts confirmed settlements, not pending ones, towards a zero balance', async () => {
    const group = await groupWithBob()
    await seedExpense(group.id, 'alice', { alice: 500, bob: 500 })
    const settlementId = await seedSettlement(group.id, 'bob', 'alice', 500, 'pending')
    const pending = await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
    expect(pending.status).toBe(409)
    expect(await errorCode(pending)).toBe('balance_not_zero')

    await resolveSettlement(settlementId, 'confirmed')
    expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)
  })

  it.each(['rejected', 'cancelled'] as const)(
    'is 409 pending_settlement for a zero balance with a pending settlement, until it is %s',
    async (outcome) => {
      const group = await groupWithBob()
      await carol(`/invites/${group.inviteCode}/join`, { method: 'POST' })
      // Bob is owed 500 by carol and owes 500 to alice: balance 0, with carol's payment to him still pending.
      await seedExpense(group.id, 'bob', { bob: 500, carol: 500 })
      await seedExpense(group.id, 'alice', { alice: 500, bob: 500 })
      const settlementId = await seedSettlement(group.id, 'carol', 'bob', 500, 'pending')

      const leave = await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
      expect(leave.status).toBe(409)
      expect(await errorCode(leave)).toBe('pending_settlement')
      const remove = await alice(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
      expect(remove.status).toBe(409)
      expect(await errorCode(remove)).toBe('pending_settlement')

      await resolveSettlement(settlementId, outcome)
      expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)
    },
  )

  it('is 409 owner_cannot_leave for the owner', async () => {
    const group = await createGroup()
    const res = await alice(`/groups/${group.id}/members/alice`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('owner_cannot_leave')
  })

  it('is 403 forbidden when a member removes someone else', async () => {
    const group = await groupWithBob()
    await carol(`/invites/${group.inviteCode}/join`, { method: 'POST' })

    const res = await bob(`/groups/${group.id}/members/carol`, { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('forbidden')
    const owner = await bob(`/groups/${group.id}/members/alice`, { method: 'DELETE' })
    expect(owner.status).toBe(403)
  })

  it('lets the owner remove a member with a zero balance', async () => {
    const group = await groupWithBob()
    expect((await alice(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)
    expect((await bob(`/groups/${group.id}`)).status).toBe(404)
  })

  it('is 404 for a non-member caller, and for a target who is not an active member', async () => {
    const group = await groupWithBob()
    expect((await carol(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice(`/groups/${group.id}/members/carol`, { method: 'DELETE' })).status).toBe(404)
    await alice(`/groups/${group.id}/members/bob`, { method: 'DELETE' })
    expect((await alice(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('loadLedger', () => {
  it('reads current members, expenses with their shares, settlements and spins of one group only', async () => {
    const group = await groupWithBob()
    const other = await createGroup(carol, { name: 'Other', emoji: '🎲' })
    await carol(`/invites/${group.inviteCode}/join`, { method: 'POST' })
    await carol(`/groups/${group.id}/members/carol`, { method: 'DELETE' })
    const expenseId = await seedExpense(group.id, 'alice', { alice: 400, bob: 600 })
    await seedExpense(other.id, 'carol', { carol: 100 })
    await seedSettlement(group.id, 'bob', 'alice', 600, 'confirmed')
    await db().insert(spins).values({
      id: 'spin-1', groupId: group.id, spunBy: 'bob', winnerId: 'alice', weightsJson: '{}', createdAt: '2026-11-19T10:00:00.000Z',
    })

    const ledger = await loadLedger(db(), group.id)

    expect(ledger.currentMemberIds.sort()).toEqual(['alice', 'bob'])
    expect(ledger.expenses).toEqual([
      {
        id: expenseId, paidBy: 'alice', amountCents: 1000, category: '🍕', createdAt: expect.any(String),
        shares: expect.arrayContaining([{ userId: 'alice', amountCents: 400 }, { userId: 'bob', amountCents: 600 }]),
      },
    ])
    expect(ledger.expenses[0]?.shares).toHaveLength(2)
    expect(ledger.settlements).toMatchObject([{ fromUserId: 'bob', toUserId: 'alice', amountCents: 600, status: 'confirmed' }])
    expect(ledger.spins).toEqual([{ winnerId: 'alice', createdAt: '2026-11-19T10:00:00.000Z' }])
  })
})

