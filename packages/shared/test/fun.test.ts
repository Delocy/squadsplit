import { describe, expect, test } from 'vitest'
import {
  type Ledger,
  type LedgerExpense,
  type LedgerSettlement,
  computeBadges,
  computeLeaderboard,
  pickWeighted,
  spinWeights,
} from '../src/index'

let n = 0
const exp = (paidBy: string, amountCents: number, shares: Record<string, number>, category = '🍕'): LedgerExpense => ({
  id: `e${++n}`,
  paidBy,
  amountCents,
  category,
  createdAt: '2026-01-01T00:00:00.000Z',
  shares: Object.entries(shares).map(([userId, amountCents]) => ({ userId, amountCents })),
})
const settle = (fromUserId: string, toUserId: string, status: LedgerSettlement['status'] = 'confirmed'): LedgerSettlement => ({
  id: `s${++n}`,
  fromUserId,
  toUserId,
  amountCents: 100,
  status,
  createdAt: '2026-01-02T00:00:00.000Z',
  resolvedAt: status === 'pending' ? null : '2026-01-03T00:00:00.000Z',
})
const spin = (winnerId: string) => ({ winnerId, createdAt: '2026-01-04T00:00:00.000Z' })
const ledger = (p: Partial<Ledger> = {}): Ledger => ({
  currentMemberIds: ['A', 'B', 'C'],
  expenses: [],
  settlements: [],
  spins: [],
  ...p,
})
const holders = (l: Ledger, key: string) =>
  computeBadges(l)
    .filter((b) => b.key === key)
    .map((b) => b.userId)

describe('computeBadges', () => {
  test('each badge goes to its single clear holder, with exact copy', () => {
    const l = ledger({
      expenses: [
        exp('A', 900, { A: 300, B: 300, C: 300 }, '🍻'),
        exp('B', 300, { A: 100, B: 100, C: 100 }),
      ],
      settlements: [settle('C', 'A'), settle('C', 'B'), settle('B', 'A')],
      spins: [spin('C'), spin('C'), spin('B')],
    })
    expect(computeBadges(l)).toEqual([
      { key: 'debt_goblin', emoji: '👺', title: 'Debt Goblin', userId: 'C' },
      { key: 'biggest_spender', emoji: '💸', title: 'Biggest Spender', userId: 'A' },
      { key: 'ghost', emoji: '👻', title: 'Ghost', userId: 'C' },
      { key: 'bar_tab', emoji: '🍻', title: 'Bar Tab Champion', userId: 'A' },
      { key: 'good_egg', emoji: '🤝', title: 'Good Egg', userId: 'C' },
      { key: 'wheel_victim', emoji: '🎰', title: 'Wheel Victim', userId: 'C' },
    ])
  })

  test('a tie for the top spot gives no badge', () => {
    const l = ledger({
      expenses: [exp('A', 600, { A: 200, B: 200, C: 200 }), exp('B', 600, { A: 200, B: 200, C: 200 })],
    })
    expect(holders(l, 'biggest_spender')).toEqual([])
  })

  test('a top value of 0 gives no badge', () => {
    const l = ledger()
    expect(computeBadges(l)).toEqual([])
  })

  test('only confirmed settlements count for Good Egg, and only those sent', () => {
    const l = ledger({ settlements: [settle('B', 'A', 'pending'), settle('B', 'A', 'rejected'), settle('A', 'B')] })
    expect(holders(l, 'good_egg')).toEqual(['A'])
  })

  test('Bar Tab only counts the 🍻 category', () => {
    const l = ledger({ expenses: [exp('A', 900, { A: 900 }), exp('B', 100, { B: 100 }, '🍻')] })
    expect(holders(l, 'bar_tab')).toEqual(['B'])
  })

  test('Ghost goes to every member with shares who has never paid', () => {
    const l = ledger({
      currentMemberIds: ['A', 'B', 'C', 'D'],
      expenses: [exp('A', 900, { A: 300, B: 300, C: 300 })],
    })
    expect(holders(l, 'ghost')).toEqual(['B', 'C'])
  })

  test('a former member with the worst balance does not get Debt Goblin or any badge', () => {
    const l = ledger({
      currentMemberIds: ['A', 'B'],
      expenses: [exp('A', 900, { A: 300, B: 100, X: 500 })],
      spins: [spin('X'), spin('X')],
    })
    const all = computeBadges(l)
    expect(all.some((b) => b.userId === 'X')).toBe(false)
    expect(holders(l, 'debt_goblin')).toEqual(['B'])
    expect(holders(l, 'wheel_victim')).toEqual([])
  })
})

describe('computeLeaderboard', () => {
  test('ranks current members by net desc, with ties sharing a rank (1,1,3)', () => {
    const l = ledger({
      currentMemberIds: ['A', 'B', 'C', 'D'],
      expenses: [exp('A', 600, { A: 100, B: 100, C: 400 }), exp('B', 300, { B: 100, C: 200 })],
    })
    // nets: A +500, B +100, C -600, D 0
    expect(computeLeaderboard(l)).toEqual([
      { userId: 'A', netCents: 500, rank: 1 },
      { userId: 'B', netCents: 100, rank: 2 },
      { userId: 'D', netCents: 0, rank: 3 },
      { userId: 'C', netCents: -600, rank: 4 },
    ])
  })

  test('ties share a rank and the next rank skips', () => {
    const l = ledger({ expenses: [exp('A', 200, { B: 100, C: 100 })] })
    expect(computeLeaderboard(l)).toEqual([
      { userId: 'A', netCents: 200, rank: 1 },
      { userId: 'B', netCents: -100, rank: 2 },
      { userId: 'C', netCents: -100, rank: 2 },
    ])
    const l2 = ledger({ expenses: [exp('A', 200, { B: 100, C: 100 }), exp('B', 200, { A: 100, C: 100 })] })
    // A +200-100 = 100, B -100+200 = 100, C -200
    expect(computeLeaderboard(l2).map((r) => [r.userId, r.rank])).toEqual([
      ['A', 1],
      ['B', 1],
      ['C', 3],
    ])
  })

  test('excludes former members', () => {
    const l = ledger({ currentMemberIds: ['A', 'B'], expenses: [exp('A', 900, { A: 300, B: 100, X: 500 })] })
    expect(computeLeaderboard(l).map((r) => r.userId)).toEqual(['A', 'B'])
  })
})

describe('spinWeights', () => {
  test('weights debtors by 1 + 3 * debt / maxDebt', () => {
    const l = ledger({ expenses: [exp('A', 450, { B: 300, C: 150 })] })
    expect(spinWeights(l)).toEqual({ A: 1, B: 4, C: 2.5 })
  })

  test('nobody owes anything gives every member weight 1', () => {
    expect(spinWeights(ledger())).toEqual({ A: 1, B: 1, C: 1 })
  })

  test('only current members, and no members gives {}', () => {
    const l = ledger({ currentMemberIds: ['A', 'B'], expenses: [exp('A', 900, { B: 300, X: 600 })] })
    expect(spinWeights(l)).toEqual({ A: 1, B: 4 })
    expect(spinWeights(ledger({ currentMemberIds: [] }))).toEqual({})
  })
})

describe('pickWeighted', () => {
  test('walks sorted ids and returns the first whose cumulative weight exceeds r * total', () => {
    expect(pickWeighted({ a: 1, b: 3 }, 0.2)).toBe('a')
    expect(pickWeighted({ a: 1, b: 3 }, 0.3)).toBe('b')
    expect(pickWeighted({ b: 3, a: 1 }, 0)).toBe('a')
    expect(pickWeighted({ a: 1, b: 3 }, 0.999)).toBe('b')
  })

  test('throws on empty weights', () => {
    expect(() => pickWeighted({}, 0.5)).toThrow()
  })
})
