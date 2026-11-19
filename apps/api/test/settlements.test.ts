import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, BalancesDTO, ExpenseDTO, GroupDTO, SettlementDTO } from '@squadsplit/shared'
import { expenses, settlements } from '../src/db/schema'
import { db, json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
const dave = app.as('dave')
type Send = typeof alice

async function errorCode(res: Response) {
  return ((await res.json()) as ApiErrorBody).error.code
}

/** Alice owns the group, Bob and Carol have joined, and Alice paid 900 split equally: Bob and Carol owe her 300 each. */
async function squad() {
  const res = await alice('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️' }))
  expect(res.status).toBe(201)
  const group = (await res.json()) as GroupDTO
  for (const member of [bob, carol]) {
    expect((await member(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
  }
  const dinner = await alice(
    `/groups/${group.id}/expenses`,
    json('POST', {
      description: 'Dinner',
      amountCents: 900,
      paidBy: 'alice',
      category: '🍕',
      spentOn: '2026-11-19',
      split: { type: 'equal', participantIds: ['alice', 'bob', 'carol'] },
    }),
  )
  expect(dinner.status).toBe(201)
  return group
}

const settle = (groupId: string, toUserId: string, amountCents: number, as: Send = bob) =>
  as(`/groups/${groupId}/settlements`, json('POST', { toUserId, amountCents }))

async function settled(groupId: string, toUserId: string, amountCents: number, as: Send = bob) {
  const res = await settle(groupId, toUserId, amountCents, as)
  expect(res.status).toBe(201)
  return (await res.json()) as SettlementDTO
}

const act = (settlementId: string, action: 'confirm' | 'reject' | 'cancel', as: Send) =>
  as(`/settlements/${settlementId}/${action}`, { method: 'POST' })

async function balances(groupId: string) {
  const res = await alice(`/groups/${groupId}/balances`)
  expect(res.status).toBe(200)
  return ((await res.json()) as BalancesDTO).balances
}

const OPENING_BALANCES = { alice: 600, bob: -300, carol: -300 }

describe('POST /groups/:id/settlements', () => {
  it('starts a pending settlement from the caller that does not change balances', async () => {
    const group = await squad()

    const settlement = await settled(group.id, 'alice', 300)

    expect(settlement).toEqual<SettlementDTO>({
      id: expect.any(String),
      groupId: group.id,
      fromUserId: 'bob',
      toUserId: 'alice',
      amountCents: 300,
      status: 'pending',
      createdAt: expect.any(String),
      resolvedAt: null,
    })
    expect(await balances(group.id)).toEqual(OPENING_BALANCES)
  })

  it('is 409 exceeds_debt above what the debtor owes', async () => {
    const group = await squad()

    const res = await settle(group.id, 'alice', 301)

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('exceeds_debt')
  })

  it('counts the debtor’s other pending settlements against the cap until they are resolved', async () => {
    const group = await squad()
    const first = await settled(group.id, 'alice', 200)

    const second = await settle(group.id, 'alice', 200)
    expect(second.status).toBe(409)
    expect(await errorCode(second)).toBe('exceeds_debt')

    expect((await act(first.id, 'cancel', bob)).status).toBe(200)
    expect((await settle(group.id, 'alice', 200)).status).toBe(201)
  })

  it('is 409 exceeds_debt for a creditor, who owes nothing', async () => {
    const group = await squad()

    const res = await settle(group.id, 'bob', 100, alice)

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('exceeds_debt')
  })

  it('is 422 self_settlement when the caller names themselves', async () => {
    const group = await squad()

    const res = await settle(group.id, 'bob', 100)

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('self_settlement')
  })

  it('is 422 not_a_member for a former member or a stranger', async () => {
    const group = await squad()
    expect((await dave(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
    expect((await dave(`/groups/${group.id}/members/dave`, { method: 'DELETE' })).status).toBe(204)

    for (const toUserId of ['dave', 'stranger']) {
      const res = await settle(group.id, toUserId, 100)
      expect(res.status).toBe(422)
      expect(await errorCode(res)).toBe('not_a_member')
    }
  })

  it('is 422 validation_failed for a bad amount', async () => {
    const group = await squad()

    const res = await settle(group.id, 'alice', 0)

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('validation_failed')
  })

  it('is 404 for a non-member', async () => {
    const group = await squad()

    const res = await settle(group.id, 'alice', 100, dave)

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not_found')
  })
})

describe('POST /settlements/:id/{confirm,reject,cancel}', () => {
  it('lets the creditor confirm, which settles the debt', async () => {
    const group = await squad()
    const settlement = await settled(group.id, 'alice', 300)

    const res = await act(settlement.id, 'confirm', alice)

    expect(res.status).toBe(200)
    const confirmed = (await res.json()) as SettlementDTO
    expect(confirmed).toEqual({ ...settlement, status: 'confirmed', resolvedAt: expect.any(String) })
    expect(await balances(group.id)).toEqual({ alice: 300, bob: 0, carol: -300 })
  })

  it('lets the creditor reject, which leaves balances unchanged', async () => {
    const group = await squad()
    const settlement = await settled(group.id, 'alice', 300)

    const res = await act(settlement.id, 'reject', alice)

    expect(res.status).toBe(200)
    expect(((await res.json()) as SettlementDTO).status).toBe('rejected')
    expect(await balances(group.id)).toEqual(OPENING_BALANCES)
  })

  it('lets the debtor cancel while pending, after which it can no longer be confirmed', async () => {
    const group = await squad()
    const settlement = await settled(group.id, 'alice', 300)

    const cancel = await act(settlement.id, 'cancel', bob)
    expect(cancel.status).toBe(200)
    expect(((await cancel.json()) as SettlementDTO).status).toBe('cancelled')

    const confirm = await act(settlement.id, 'confirm', alice)
    expect(confirm.status).toBe(409)
    expect(await errorCode(confirm)).toBe('not_pending')
    expect(await balances(group.id)).toEqual(OPENING_BALANCES)
  })

  it('is 409 not_pending when confirming twice', async () => {
    const group = await squad()
    const settlement = await settled(group.id, 'alice', 300)
    expect((await act(settlement.id, 'confirm', alice)).status).toBe(200)

    const again = await act(settlement.id, 'confirm', alice)

    expect(again.status).toBe(409)
    expect(await errorCode(again)).toBe('not_pending')
    expect(await balances(group.id)).toEqual({ alice: 300, bob: 0, carol: -300 })
  })

  it('is 403 for a member who is not the right party', async () => {
    const group = await squad()
    const settlement = await settled(group.id, 'alice', 300)

    const attempts: [string, 'confirm' | 'reject' | 'cancel', Send][] = [
      ['bob confirms his own', 'confirm', bob],
      ['carol confirms', 'confirm', carol],
      ['bob rejects his own', 'reject', bob],
      ['alice cancels', 'cancel', alice],
      ['carol cancels', 'cancel', carol],
    ]
    for (const [label, action, as] of attempts) {
      const res = await act(settlement.id, action, as)
      expect(res.status, label).toBe(403)
      expect(await errorCode(res), label).toBe('forbidden')
    }
    expect((await act(settlement.id, 'confirm', alice)).status).toBe(200)
  })

  it('is 404 for an unknown settlement or a caller outside its group', async () => {
    const group = await squad()
    const settlement = await settled(group.id, 'alice', 300)

    const unknown = await act('no-such-settlement', 'confirm', alice)
    expect(unknown.status).toBe(404)
    expect(await errorCode(unknown)).toBe('not_found')

    const outsider = await act(settlement.id, 'confirm', dave)
    expect(outsider.status).toBe(404)
    expect(await errorCode(outsider)).toBe('not_found')
  })

  it('locks an expense created before the confirmation that involves the debtor', async () => {
    const group = await squad()
    const [dinner] = (await (await alice(`/groups/${group.id}/expenses`)).json()) as ExpenseDTO[]
    // Pin the expense safely in the past, so the confirmation cannot land in the same millisecond.
    await db().update(expenses).set({ createdAt: '2026-01-01T00:00:00.000Z' }).where(eq(expenses.id, dinner!.id))
    const settlement = await settled(group.id, 'alice', 300)
    expect(((await (await alice(`/groups/${group.id}/expenses`)).json()) as ExpenseDTO[])[0]!.locked).toBe(false)

    expect((await act(settlement.id, 'confirm', alice)).status).toBe(200)

    const [after] = (await (await alice(`/groups/${group.id}/expenses`)).json()) as ExpenseDTO[]
    expect(after).toMatchObject({ id: dinner!.id, locked: true })
  })
})

describe('GET /groups/:id/settlements', () => {
  async function seed(groupId: string, status: SettlementDTO['status'], createdAt: string) {
    const id = crypto.randomUUID()
    await db().insert(settlements).values({
      id, groupId, fromUserId: 'bob', toUserId: 'alice', amountCents: 100, status,
      createdAt, resolvedAt: status === 'pending' ? null : createdAt,
    })
    return id
  }

  it('lists the group’s settlements newest first, optionally filtered by status', async () => {
    const group = await squad()
    const older = await seed(group.id, 'pending', '2026-11-19T10:00:00.000Z')
    const confirmed = await seed(group.id, 'confirmed', '2026-11-19T11:00:00.000Z')
    const newer = await seed(group.id, 'pending', '2026-11-19T12:00:00.000Z')
    await seed((await squad()).id, 'pending', '2026-11-19T13:00:00.000Z')

    const all = await carol(`/groups/${group.id}/settlements`)
    expect(all.status).toBe(200)
    expect(((await all.json()) as SettlementDTO[]).map((s) => s.id)).toEqual([newer, confirmed, older])

    const pending = await carol(`/groups/${group.id}/settlements?status=pending`)
    expect(pending.status).toBe(200)
    const body = (await pending.json()) as SettlementDTO[]
    expect(body.map((s) => s.id)).toEqual([newer, older])
    expect(body[0]).toEqual<SettlementDTO>({
      id: newer, groupId: group.id, fromUserId: 'bob', toUserId: 'alice', amountCents: 100,
      status: 'pending', createdAt: '2026-11-19T12:00:00.000Z', resolvedAt: null,
    })
  })

  it('is 422 for an unknown status and 404 for a non-member', async () => {
    const group = await squad()

    const invalid = await alice(`/groups/${group.id}/settlements?status=paid`)
    expect(invalid.status).toBe(422)
    expect(await errorCode(invalid)).toBe('validation_failed')

    const outsider = await dave(`/groups/${group.id}/settlements`)
    expect(outsider.status).toBe(404)
    expect(await errorCode(outsider)).toBe('not_found')
  })
})
