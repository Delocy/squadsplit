import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  SG_PRESET,
  itemizedTotal,
  simplifyDebts,
  splitItemized,
  type ApiErrorBody,
  type BalancesDTO,
  type BillItem,
  type ExpenseDTO,
  type GroupDTO,
} from '@squadsplit/shared'
import { expenseItemUsers, expenseItems, expenseShares, expenses, settlements } from '../src/db/schema'
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

/** Alice owns the group; bob and carol have joined it. */
async function squad(input: object = { name: 'Bali trip', emoji: '🏝️' }) {
  const res = await alice('/groups', json('POST', input))
  expect(res.status).toBe(201)
  const group = (await res.json()) as GroupDTO
  for (const member of [bob, carol]) {
    expect((await member(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
  }
  return group
}

const dinner = (overrides: object = {}) => ({
  description: 'Dinner',
  amountCents: 900,
  paidBy: 'bob',
  category: '🍕',
  spentOn: '2026-11-19',
  split: { type: 'equal', participantIds: ['alice', 'bob', 'carol'] },
  ...overrides,
})

const BILL_ITEMS: BillItem[] = [
  { name: 'Chicken rice', amountCents: 1000, userIds: ['alice', 'bob'] },
  { name: 'Beer', amountCents: 1500, userIds: ['bob'] },
  { name: 'Fries', amountCents: 700, userIds: ['alice', 'bob', 'carol'] },
]
const SG_BILL = { items: BILL_ITEMS, ...SG_PRESET }

const itemizedDinner = (items: BillItem[] = BILL_ITEMS) => {
  const bill = { items, ...SG_PRESET }
  return dinner({ amountCents: itemizedTotal(bill), split: { type: 'itemized', ...bill } })
}

async function logExpense(groupId: string, body: object = dinner(), as: Send = alice) {
  const res = await as(`/groups/${groupId}/expenses`, json('POST', body))
  expect(res.status).toBe(201)
  return (await res.json()) as ExpenseDTO
}

async function listExpenses(groupId: string, as: Send = alice) {
  const res = await as(`/groups/${groupId}/expenses`)
  expect(res.status).toBe(200)
  return (await res.json()) as ExpenseDTO[]
}

async function storedShares(expenseId: string) {
  const rows = await db().select().from(expenseShares).where(eq(expenseShares.expenseId, expenseId))
  return Object.fromEntries(rows.map((r) => [r.userId, r.amountCents]))
}

describe('POST /groups/:id/expenses', () => {
  it('lets any member log an expense paid by another member', async () => {
    const group = await squad()

    const expense = await logExpense(group.id)

    expect(expense).toEqual<ExpenseDTO>({
      id: expect.any(String),
      groupId: group.id,
      description: 'Dinner',
      amountCents: 900,
      paidBy: 'bob',
      createdBy: 'alice',
      category: '🍕',
      spentOn: '2026-11-19',
      splitType: 'equal',
      shares: [
        { userId: 'alice', amountCents: 300 },
        { userId: 'bob', amountCents: 300 },
        { userId: 'carol', amountCents: 300 },
      ],
      currency: 'SGD',
      fxRatePpm: 1_000_000,
      serviceChargeBps: null,
      gstBps: null,
      items: null,
      locked: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(await listExpenses(group.id, carol)).toEqual([expense])
  })

  it('stores exact shares as sent', async () => {
    const group = await squad()

    const expense = await logExpense(
      group.id,
      dinner({ split: { type: 'exact', shares: [{ userId: 'alice', amountCents: 200 }, { userId: 'carol', amountCents: 700 }] } }),
    )

    expect(expense.splitType).toBe('exact')
    expect(expense.shares).toEqual([
      { userId: 'alice', amountCents: 200 },
      { userId: 'carol', amountCents: 700 },
    ])
  })

  it('rejects an equal split smaller than the head count with 422 amount_too_small', async () => {
    const group = await squad()

    const res = await alice(`/groups/${group.id}/expenses`, json('POST', dinner({ amountCents: 2 })))

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('amount_too_small')
    expect(await listExpenses(group.id)).toEqual([])
  })

  it('rejects an invalid body with 422 validation_failed', async () => {
    const group = await squad()

    const res = await alice(`/groups/${group.id}/expenses`, json('POST', dinner({ amountCents: 0 })))

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('validation_failed')
  })

  it('rejects a payer or participant who is not an active member with 422 not_a_member', async () => {
    const group = await squad()
    await dave('/groups') // dave has an account but never joined
    expect((await carol(`/groups/${group.id}/members/carol`, { method: 'DELETE' })).status).toBe(204)

    const bodies = [
      dinner({ paidBy: 'carol', split: { type: 'equal', participantIds: ['alice', 'bob'] } }),
      dinner({ paidBy: 'dave', split: { type: 'equal', participantIds: ['alice', 'bob'] } }),
      dinner({ split: { type: 'equal', participantIds: ['alice', 'bob', 'carol'] } }),
      dinner({ split: { type: 'exact', shares: [{ userId: 'alice', amountCents: 400 }, { userId: 'nobody', amountCents: 500 }] } }),
    ]
    for (const body of bodies) {
      const res = await alice(`/groups/${group.id}/expenses`, json('POST', body))
      expect(res.status).toBe(422)
      expect(await errorCode(res)).toBe('not_a_member')
    }
    expect(await listExpenses(group.id)).toEqual([])
  })

  it('defaults the currency to the group currency with an fx rate of 1000000', async () => {
    const group = await squad({ name: 'Paris', emoji: '🥐', currency: 'EUR' })

    const expense = await logExpense(group.id)

    expect(expense).toMatchObject({ currency: 'EUR', fxRatePpm: 1_000_000 })
    expect(await logExpense(group.id, dinner({ currency: 'EUR' }))).toMatchObject({ currency: 'EUR' })
  })

  it('rejects a currency other than the group currency with 422 currency_mismatch', async () => {
    const group = await squad({ name: 'Paris', emoji: '🥐', currency: 'EUR' })

    const res = await alice(`/groups/${group.id}/expenses`, json('POST', dinner({ currency: 'SGD' })))

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('currency_mismatch')
  })
})

describe('itemized expenses', () => {
  it('stores the items and the splitItemized shares, and returns them with the SG preset', async () => {
    const group = await squad()

    const expense = await logExpense(group.id, itemizedDinner())

    const expected = splitItemized(SG_BILL, 'bob')
    expect(await storedShares(expense.id)).toEqual(expected)
    expect(expense).toMatchObject({
      splitType: 'itemized',
      amountCents: itemizedTotal(SG_BILL),
      serviceChargeBps: 1000,
      gstBps: 900,
      items: BILL_ITEMS,
    })
    expect(expense.shares).toEqual(Object.entries(expected).map(([userId, amountCents]) => ({ userId, amountCents })))
    expect((await listExpenses(group.id))[0]).toEqual(expense)
  })

  it('stores a bill with the maximum of 50 items', async () => {
    const group = await squad()
    const items = Array.from({ length: 50 }, (_, i) => ({ name: `Dish ${i + 1}`, amountCents: 100 + i, userIds: ['alice', 'bob', 'carol'] }))

    const expense = await logExpense(group.id, itemizedDinner(items))

    expect(expense.items).toEqual(items)
    expect(await db().select().from(expenseItemUsers)).toHaveLength(150)
  })

  it('rejects an item user who is not an active member with 422 not_a_member', async () => {
    const group = await squad()
    await dave('/groups')

    const res = await alice(
      `/groups/${group.id}/expenses`,
      json('POST', itemizedDinner([...BILL_ITEMS, { name: 'Dessert', amountCents: 500, userIds: ['dave'] }])),
    )

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('not_a_member')
  })

  it('removes the items when a PATCH switches the expense to an equal split', async () => {
    const group = await squad()
    const expense = await logExpense(group.id, itemizedDinner())
    expect(await db().select().from(expenseItems)).toHaveLength(3)

    const res = await alice(`/expenses/${expense.id}`, json('PATCH', dinner()))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ splitType: 'equal', items: null, serviceChargeBps: null, gstBps: null })
    expect(await db().select().from(expenseItems)).toEqual([])
    expect(await db().select().from(expenseItemUsers)).toEqual([])
    expect(await storedShares(expense.id)).toEqual({ alice: 300, bob: 300, carol: 300 })
  })
})

describe('GET /groups/:id/expenses', () => {
  it('lists the newest spentOn first, then the newest createdAt', async () => {
    const group = await squad()
    const older = await logExpense(group.id, dinner({ description: 'Older', spentOn: '2026-11-18' }))
    const first = await logExpense(group.id, dinner({ description: 'First' }))
    const second = await logExpense(group.id, dinner({ description: 'Second' }))
    await db().update(expenses).set({ createdAt: '2026-11-19T10:00:00.000Z' }).where(eq(expenses.id, first.id))
    await db().update(expenses).set({ createdAt: '2026-11-19T11:00:00.000Z' }).where(eq(expenses.id, second.id))

    const list = await listExpenses(group.id)

    expect(list.map((e) => e.description)).toEqual(['Second', 'First', 'Older'])
    expect(list[2]?.id).toBe(older.id)
  })
})

describe('PATCH /expenses/:id', () => {
  it('lets only the creator or the group owner edit', async () => {
    const group = await squad()
    const expense = await logExpense(group.id, dinner(), bob)

    const byCarol = await carol(`/expenses/${expense.id}`, json('PATCH', dinner({ description: 'Carol was here' })))
    expect(byCarol.status).toBe(403)
    expect(await errorCode(byCarol)).toBe('forbidden')

    const byCreator = await bob(`/expenses/${expense.id}`, json('PATCH', dinner({ description: 'Bob edit' })))
    expect(byCreator.status).toBe(200)
    expect(await byCreator.json()).toMatchObject({ description: 'Bob edit' })

    const byOwner = await alice(`/expenses/${expense.id}`, json('PATCH', dinner({ description: 'Alice edit' })))
    expect(byOwner.status).toBe(200)
    expect(await byOwner.json()).toMatchObject({ description: 'Alice edit' })
  })

  it('replaces the fields and shares, keeps createdAt and createdBy, and bumps updatedAt', async () => {
    const group = await squad()
    const expense = await logExpense(group.id, dinner(), bob)
    await db().update(expenses).set({ createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z' }).where(eq(expenses.id, expense.id))

    const res = await alice(
      `/expenses/${expense.id}`,
      json('PATCH', dinner({ description: 'Taxi', amountCents: 1001, paidBy: 'carol', category: '🚕', spentOn: '2026-11-20', split: { type: 'equal', participantIds: ['bob', 'carol'] } })),
    )

    expect(res.status).toBe(200)
    const updated = (await res.json()) as ExpenseDTO
    expect(updated).toMatchObject({
      id: expense.id,
      description: 'Taxi',
      amountCents: 1001,
      paidBy: 'carol',
      createdBy: 'bob',
      category: '🚕',
      spentOn: '2026-11-20',
      shares: [
        { userId: 'bob', amountCents: 500 },
        { userId: 'carol', amountCents: 501 },
      ],
      createdAt: '2026-01-01T10:00:00.000Z',
    })
    expect(updated.updatedAt > '2026-01-01T10:00:00.000Z').toBe(true)
    expect(await storedShares(expense.id)).toEqual({ bob: 500, carol: 501 })
  })

  it('validates the replacement like POST', async () => {
    const group = await squad()
    const expense = await logExpense(group.id)

    const tooSmall = await alice(`/expenses/${expense.id}`, json('PATCH', dinner({ amountCents: 2 })))
    expect(tooSmall.status).toBe(422)
    expect(await errorCode(tooSmall)).toBe('amount_too_small')

    const stranger = await alice(`/expenses/${expense.id}`, json('PATCH', dinner({ paidBy: 'dave' })))
    expect(stranger.status).toBe(422)
    expect(await errorCode(stranger)).toBe('not_a_member')

    expect(await listExpenses(group.id)).toEqual([expense])
  })
})

describe('DELETE /expenses/:id', () => {
  it('deletes the expense with its shares and items', async () => {
    const group = await squad()
    const expense = await logExpense(group.id, itemizedDinner(), bob)

    expect((await carol(`/expenses/${expense.id}`, { method: 'DELETE' })).status).toBe(403)
    const res = await bob(`/expenses/${expense.id}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(await listExpenses(group.id)).toEqual([])
    expect(await db().select().from(expenseShares)).toEqual([])
    expect(await db().select().from(expenseItems)).toEqual([])
    expect(await db().select().from(expenseItemUsers)).toEqual([])
    expect((await bob(`/expenses/${expense.id}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('lock rule', () => {
  it('locks an expense once a later confirmed settlement involves one of its people', async () => {
    const group = await squad()
    const expense = await logExpense(group.id, dinner({ split: { type: 'equal', participantIds: ['alice', 'bob'] } }))
    await db().update(expenses).set({ createdAt: '2026-11-19T10:00:00.000Z' }).where(eq(expenses.id, expense.id))
    await db().insert(settlements).values({
      id: crypto.randomUUID(), groupId: group.id, fromUserId: 'alice', toUserId: 'bob', amountCents: 450,
      status: 'confirmed', createdAt: '2026-11-19T11:00:00.000Z', resolvedAt: '2026-11-19T12:00:00.000Z',
    })

    const patch = await alice(`/expenses/${expense.id}`, json('PATCH', dinner()))
    expect(patch.status).toBe(409)
    expect(await errorCode(patch)).toBe('expense_locked')

    const del = await alice(`/expenses/${expense.id}`, { method: 'DELETE' })
    expect(del.status).toBe(409)
    expect(await errorCode(del)).toBe('expense_locked')

    expect((await listExpenses(group.id)).map((e) => e.locked)).toEqual([true])
  })

  describe('when an edit would bring in someone with a later confirmed settlement', () => {
    /** Bob paid an alice+bob dinner at 10:00; carol and dave confirmed a settlement at 12:00, so it isn't locked yet. */
    async function unlockedDinner() {
      const group = await squad()
      expect((await dave(`/invites/${group.inviteCode}/join`, { method: 'POST' })).status).toBe(200)
      const expense = await logExpense(group.id, dinner({ split: { type: 'equal', participantIds: ['alice', 'bob'] } }))
      await db().update(expenses).set({ createdAt: '2026-11-19T10:00:00.000Z' }).where(eq(expenses.id, expense.id))
      await db().insert(settlements).values({
        id: crypto.randomUUID(), groupId: group.id, fromUserId: 'carol', toUserId: 'dave', amountCents: 100,
        status: 'confirmed', createdAt: '2026-11-19T11:00:00.000Z', resolvedAt: '2026-11-19T12:00:00.000Z',
      })
      expect((await listExpenses(group.id)).map((e) => e.locked)).toEqual([false])
      return expense
    }

    it.each([
      ['an equal participant', dinner({ split: { type: 'equal', participantIds: ['alice', 'bob', 'carol'] } })],
      ['the payer', dinner({ paidBy: 'carol', split: { type: 'equal', participantIds: ['alice', 'bob'] } })],
      ['an exact share', dinner({ split: { type: 'exact', shares: [{ userId: 'alice', amountCents: 450 }, { userId: 'dave', amountCents: 450 }] } })],
      ['an itemized item', itemizedDinner([{ name: 'Satay', amountCents: 600, userIds: ['alice', 'carol'] }])],
    ])('is 409 expense_locked when adding them as %s', async (_, body) => {
      const expense = await unlockedDinner()

      const res = await alice(`/expenses/${expense.id}`, json('PATCH', body))

      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('expense_locked')
      expect(await storedShares(expense.id)).toEqual({ alice: 450, bob: 450 })
    })

    it('still allows an edit that keeps the same people', async () => {
      const expense = await unlockedDinner()

      const res = await alice(`/expenses/${expense.id}`, json('PATCH', dinner({ amountCents: 1000, split: { type: 'equal', participantIds: ['alice', 'bob'] } })))

      expect(res.status).toBe(200)
      expect(await storedShares(expense.id)).toEqual({ alice: 500, bob: 500 })
    })
  })

  it('checks permission before the lock', async () => {
    const group = await squad()
    const expense = await logExpense(group.id, dinner(), bob)
    await db().insert(settlements).values({
      id: crypto.randomUUID(), groupId: group.id, fromUserId: 'alice', toUserId: 'bob', amountCents: 300,
      status: 'confirmed', createdAt: '2099-01-01T00:00:00.000Z', resolvedAt: '2099-01-01T00:00:00.000Z',
    })

    expect((await carol(`/expenses/${expense.id}`, { method: 'DELETE' })).status).toBe(403)
  })
})

describe('former members', () => {
  /**
   * Carol pays one expense and shares an itemized one, then a top-up expense brings her balance to exactly 0
   * so she can leave. No settlement is confirmed, so none of the expenses is locked.
   */
  async function carolLeaves() {
    const group = await squad()
    const paidByCarol = await logExpense(group.id, dinner({ amountCents: 600, paidBy: 'carol', split: { type: 'equal', participantIds: ['alice', 'carol'] } }))
    const sharedByCarol = await logExpense(group.id, itemizedDinner([{ name: 'Satay', amountCents: 600, userIds: ['alice', 'carol'] }]))
    const net = ((await (await alice(`/groups/${group.id}/balances`)).json()) as BalancesDTO).balances.carol ?? 0
    const [payer, debtor] = net < 0 ? ['carol', 'alice'] : ['alice', 'carol']
    await logExpense(group.id, dinner({ amountCents: Math.abs(net), paidBy: payer, split: { type: 'exact', shares: [{ userId: debtor, amountCents: Math.abs(net) }] } }))
    expect((await carol(`/groups/${group.id}/members/carol`, { method: 'DELETE' })).status).toBe(204)
    return { group, paidByCarol, sharedByCarol }
  }

  it('PATCH answers 409 expense_has_former_member when the payer or a share belongs to someone who left', async () => {
    const { group, paidByCarol, sharedByCarol } = await carolLeaves()
    for (const e of [paidByCarol, sharedByCarol]) {
      const res = await alice(`/expenses/${e.id}`, json('PATCH', dinner({ description: 'Renamed', paidBy: 'alice', split: { type: 'equal', participantIds: ['alice', 'bob'] } })))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({
        error: { code: 'expense_has_former_member', message: "Someone in this expense has left the group, so it can't be changed." },
      })
    }
    expect((await listExpenses(group.id)).find((e) => e.id === paidByCarol.id)).toEqual(paidByCarol)
  })

  it('DELETE answers 409 expense_has_former_member, and the expense stays', async () => {
    const { group, sharedByCarol } = await carolLeaves()
    const res = await alice(`/expenses/${sharedByCarol.id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('expense_has_former_member')
    expect((await listExpenses(group.id)).map((e) => e.id)).toContain(sharedByCarol.id)
  })

  it('checks permission first, and leaves expenses without the former member editable', async () => {
    const { group, sharedByCarol } = await carolLeaves()
    expect((await bob(`/expenses/${sharedByCarol.id}`, { method: 'DELETE' })).status).toBe(403)
    const unrelated = await logExpense(group.id, dinner({ paidBy: 'alice', split: { type: 'equal', participantIds: ['alice', 'bob'] } }))
    expect((await alice(`/expenses/${unrelated.id}`, { method: 'DELETE' })).status).toBe(204)
  })
})

describe('GET /groups/:id/balances', () => {
  it('returns the nets and the simplified debts', async () => {
    const group = await squad()
    await logExpense(group.id)
    await logExpense(group.id, dinner({ amountCents: 600, paidBy: 'carol', split: { type: 'equal', participantIds: ['alice', 'carol'] } }))

    const res = await carol(`/groups/${group.id}/balances`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as BalancesDTO
    expect(body.balances).toEqual({ alice: -600, bob: 600, carol: 0 })
    expect(body.suggestions).toEqual(simplifyDebts(body.balances))
    expect(body.suggestions).toEqual([{ fromUserId: 'alice', toUserId: 'bob', amountCents: 600 }])
  })
})

describe('non-members', () => {
  it('get 404 on every expense and balances route', async () => {
    const group = await squad()
    const expense = await logExpense(group.id)
    // Bob leaves (a former member is a non-member too). After this edit he owes and is owed nothing.
    await alice(`/expenses/${expense.id}`, json('PATCH', dinner({ paidBy: 'alice', split: { type: 'equal', participantIds: ['alice', 'carol'] } })))
    expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)

    for (const outsider of [dave, bob]) {
      const responses = [
        await outsider(`/groups/${group.id}/expenses`),
        await outsider(`/groups/${group.id}/expenses`, json('POST', dinner({ paidBy: 'alice' }))),
        await outsider(`/groups/${group.id}/balances`),
        await outsider(`/expenses/${expense.id}`, json('PATCH', dinner({ paidBy: 'alice' }))),
        await outsider(`/expenses/${expense.id}`, { method: 'DELETE' }),
      ]
      for (const res of responses) {
        expect(res.status).toBe(404)
        expect(await errorCode(res)).toBe('not_found')
      }
    }
  })

  it('get 404 for an unknown expense', async () => {
    await squad()
    const res = await alice('/expenses/nope', json('PATCH', dinner()))
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not_found')
    expect((await alice('/expenses/nope', { method: 'DELETE' })).status).toBe(404)
  })
})
