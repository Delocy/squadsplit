import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody, FeedItem, FunDTO, GroupDTO, SettlementDTO, SpinDTO } from '@squadsplit/shared'
import { json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
const dave = app.as('dave')

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function newGroup(joiners: (typeof alice)[] = [bob, carol]) {
  const res = await alice('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️' }))
  expect(res.status).toBe(201)
  const group = (await res.json()) as GroupDTO
  for (const member of joiners) {
    expect((await member(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
  }
  return group
}

/** Alice paid 900 split equally: Bob and Carol owe her 300 each. */
const dinner = (groupId: string, amountCents = 900, participantIds = ['alice', 'bob', 'carol']) =>
  alice(
    `/groups/${groupId}/expenses`,
    json('POST', {
      description: 'Dinner',
      amountCents,
      paidBy: 'alice',
      category: '🍕',
      spentOn: '2026-11-19',
      split: { type: 'equal', participantIds },
    }),
  )

const spin = (groupId: string, as = alice) => as(`/groups/${groupId}/spins`, { method: 'POST' })
const feed = async (groupId: string) => (await (await alice(`/groups/${groupId}/feed`)).json()) as FeedItem[]

/** Makes the wheel's random number come out as `r`. */
function stubRandom(r: number) {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
    array[0] = Math.floor(r * 2 ** 32)
    return array
  }) as typeof crypto.getRandomValues)
}

describe('GET /groups/:id/badges', () => {
  it('gives the biggest debtor the 👺 badge and ranks the leaderboard', async () => {
    const group = await newGroup()
    await dinner(group.id)
    // Bob is now the sole biggest debtor.
    const res = await alice(
      `/groups/${group.id}/expenses`,
      json('POST', {
        description: 'Taxi',
        amountCents: 600,
        paidBy: 'alice',
        category: '🚕',
        spentOn: '2026-11-19',
        split: { type: 'exact', shares: [{ userId: 'bob', amountCents: 600 }] },
      }),
    )
    expect(res.status).toBe(201)

    const fun = (await (await carol(`/groups/${group.id}/badges`)).json()) as FunDTO

    expect(fun.badges.find((b) => b.key === 'debt_goblin')).toMatchObject({ emoji: '👺', userId: 'bob' })
    expect(fun.leaderboard).toEqual([
      { userId: 'alice', netCents: 1200, rank: 1 },
      { userId: 'carol', netCents: -300, rank: 2 },
      { userId: 'bob', netCents: -900, rank: 3 },
    ])
  })

  it('is a 404 for a non-member', async () => {
    const group = await newGroup()
    const res = await dave(`/groups/${group.id}/badges`)
    expect(res.status).toBe(404)
  })
})

describe('POST /groups/:id/spins', () => {
  it('creates a spin won by a current member, with the weights used, and shows it in the feed', async () => {
    const group = await newGroup()
    await dinner(group.id)

    const res = await spin(group.id, carol)

    expect(res.status).toBe(201)
    const created = (await res.json()) as SpinDTO
    expect(created).toEqual<SpinDTO>({
      id: expect.any(String),
      groupId: group.id,
      spunBy: 'carol',
      winnerId: expect.stringMatching(/^(alice|bob|carol)$/),
      weights: { alice: 1, bob: 4, carol: 4 },
      createdAt: expect.any(String),
    })
    expect((await feed(group.id)).filter((i) => i.type === 'spin')).toEqual([
      { type: 'spin', at: created.createdAt, spin: created },
    ])
  })

  it('picks the winner by weight from the random number', async () => {
    const group = await newGroup()
    await dinner(group.id)
    // weights alice 1, bob 4, carol 4 (total 9): r < 1/9 alice, < 5/9 bob, else carol
    const winners: string[] = []
    for (const r of [0, 0.5, 0.99]) {
      stubRandom(r)
      winners.push(((await (await spin(group.id)).json()) as SpinDTO).winnerId)
      vi.restoreAllMocks()
    }
    expect(winners).toEqual(['alice', 'bob', 'carol'])
  })

  it('never picks a former member', async () => {
    const group = await newGroup()
    expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)

    for (const r of [0, 0.5, 0.99]) {
      stubRandom(r)
      const res = await spin(group.id)
      expect(res.status).toBe(201)
      const created = (await res.json()) as SpinDTO
      expect(['alice', 'carol']).toContain(created.winnerId)
      expect(Object.keys(created.weights).sort()).toEqual(['alice', 'carol'])
      vi.restoreAllMocks()
    }
  })

  it('is a 404 for a non-member', async () => {
    const group = await newGroup()
    const res = await spin(group.id, dave)
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found')
  })
})

describe('GET /groups/:id/feed', () => {
  it('interleaves expenses, confirmed settlements, spins and joins, newest first, without pending settlements', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const at = (seconds: number) => new Date(Date.UTC(2026, 10, 19, 12, 0, seconds)).toISOString()
    const tick = (seconds: number) => vi.setSystemTime(at(seconds))

    tick(0)
    const group = await newGroup([bob]) // alice created the group (join), bob joined
    tick(10)
    const expense = await dinner(group.id, 800, ['alice', 'bob']) // bob owes alice 400
    expect(expense.status).toBe(201)
    tick(20)
    const settled = (await (await bob(`/groups/${group.id}/settlements`, json('POST', { toUserId: 'alice', amountCents: 100 }))).json()) as SettlementDTO
    const pending = (await (await bob(`/groups/${group.id}/settlements`, json('POST', { toUserId: 'alice', amountCents: 100 }))).json()) as SettlementDTO
    tick(30)
    expect((await alice(`/settlements/${settled.id}/confirm`, { method: 'POST' })).status).toBe(200)
    tick(40)
    expect((await spin(group.id)).status).toBe(201)
    tick(50)
    expect((await dave(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)

    const items = await feed(group.id)

    expect(items.map((i) => [i.type, i.at])).toEqual([
      ['join', at(50)],
      ['spin', at(40)],
      ['settlement', at(30)],
      ['expense', at(10)],
      ['join', at(0)],
      ['join', at(0)],
    ])
    expect(items.some((i) => i.type === 'settlement' && i.settlement.id === pending.id)).toBe(false)
    const first = items.find((i) => i.type === 'expense')
    expect(first).toMatchObject({ expense: { description: 'Dinner', locked: true } })
    expect(items.find((i) => i.type === 'settlement')).toMatchObject({ settlement: { id: settled.id, status: 'confirmed' } })
    expect(items.filter((i) => i.type === 'join').map((i) => (i as { userId: string }).userId)).toEqual(['dave', 'bob', 'alice'])
  })

  it('orders items with the same time as expense, settlement, spin, join', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-19T12:00:00.000Z')
    const group = await newGroup([bob])
    await dinner(group.id, 800, ['alice', 'bob'])
    const settled = (await (await bob(`/groups/${group.id}/settlements`, json('POST', { toUserId: 'alice', amountCents: 100 }))).json()) as SettlementDTO
    await alice(`/settlements/${settled.id}/confirm`, { method: 'POST' })
    await spin(group.id)

    const items = await feed(group.id)

    expect(items.map((i) => i.type)).toEqual(['expense', 'settlement', 'spin', 'join', 'join'])
  })

  it('keeps former members joins, and returns at most 50 items', async () => {
    const group = await newGroup([bob])
    expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)
    expect((await feed(group.id)).filter((i) => i.type === 'join')).toHaveLength(2)

    for (let i = 0; i < 52; i++) expect((await spin(group.id)).status).toBe(201)
    expect(await feed(group.id)).toHaveLength(50)
  })

  it('is a 404 for a non-member', async () => {
    const group = await newGroup()
    expect((await dave(`/groups/${group.id}/feed`)).status).toBe(404)
  })
})
