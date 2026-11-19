import { describe, expect, test } from 'vitest'
import {
  type Ledger,
  type LedgerExpense,
  type LedgerSettlement,
  computeBalances,
  isExpenseLocked,
  maxSettlementAmount,
  settlementCap,
  simplifyDebts,
} from '../src/index'

const exp900: LedgerExpense = {
  id: 'e1',
  paidBy: 'A',
  amountCents: 900,
  category: '🍕',
  createdAt: '2026-01-01T00:00:00.000Z',
  shares: [
    { userId: 'A', amountCents: 300 },
    { userId: 'B', amountCents: 300 },
    { userId: 'C', amountCents: 300 },
  ],
}
const stl = (over: Partial<LedgerSettlement> = {}): LedgerSettlement => ({
  id: 's1',
  fromUserId: 'B',
  toUserId: 'A',
  amountCents: 300,
  status: 'confirmed',
  createdAt: '2026-01-02T00:00:00.000Z',
  resolvedAt: '2026-01-03T00:00:00.000Z',
  ...over,
})
const ledger = (settlements: LedgerSettlement[] = []): Ledger => ({
  currentMemberIds: ['A', 'B', 'C'],
  expenses: [exp900],
  settlements,
  spins: [],
})

describe('computeBalances', () => {
  test('expense split equally', () => expect(computeBalances(ledger())).toEqual({ A: 600, B: -300, C: -300 }))
  test('confirmed settlement moves balances', () =>
    expect(computeBalances(ledger([stl()]))).toEqual({ A: 300, B: 0, C: -300 }))
  test.each(['pending', 'rejected', 'cancelled'] as const)('%s settlement changes nothing', (status) =>
    expect(computeBalances(ledger([stl({ status, resolvedAt: null })]))).toEqual({ A: 600, B: -300, C: -300 }))
  test('sums to zero and includes former members from history', () => {
    const l = { ...ledger([stl()]), currentMemberIds: ['A', 'B'] }
    const b = computeBalances(l)
    expect(Object.keys(b).sort()).toEqual(['A', 'B', 'C'])
    expect(Object.values(b).reduce((x, y) => x + y, 0)).toBe(0)
  })
  test('current members with no history appear as 0', () =>
    expect(computeBalances({ ...ledger(), currentMemberIds: ['A', 'B', 'C', 'D'] }).D).toBe(0))
})

describe('simplifyDebts', () => {
  test('two debtors to one creditor', () =>
    expect(simplifyDebts({ A: 600, B: -300, C: -300 })).toEqual([
      { fromUserId: 'B', toUserId: 'A', amountCents: 300 },
      { fromUserId: 'C', toUserId: 'A', amountCents: 300 },
    ]))
  test('largest debtor first', () =>
    expect(simplifyDebts({ A: 500, B: -200, C: -300 })).toEqual([
      { fromUserId: 'C', toUserId: 'A', amountCents: 300 },
      { fromUserId: 'B', toUserId: 'A', amountCents: 200 },
    ]))
  test('all zeros', () => expect(simplifyDebts({ A: 0, B: 0 })).toEqual([]))
  test('applying transfers zeroes every balance', () => {
    const bal: Record<string, number> = { A: 700, B: 150, C: -420, D: -280, E: -150, F: 0 }
    const after = { ...bal }
    for (const t of simplifyDebts(bal)) {
      expect(Number.isInteger(t.amountCents) && t.amountCents > 0).toBe(true)
      after[t.fromUserId]! += t.amountCents
      after[t.toUserId]! -= t.amountCents
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true)
  })
})

describe('maxSettlementAmount', () => {
  test('min of debt and credit', () => expect(maxSettlementAmount(ledger(), 'B', 'A')).toBe(300))
  test('minus pending outgoing', () =>
    expect(maxSettlementAmount(ledger([stl({ status: 'pending', amountCents: 100, resolvedAt: null })]), 'B', 'A')).toBe(200))
  test('pending to someone else also counts', () =>
    expect(maxSettlementAmount(ledger([stl({ status: 'pending', toUserId: 'C', amountCents: 100, resolvedAt: null })]), 'B', 'A')).toBe(200))
  test('never negative', () =>
    expect(maxSettlementAmount(ledger([stl({ status: 'pending', amountCents: 300, resolvedAt: null })]), 'B', 'A')).toBe(0))
  test('from a creditor is 0', () => expect(maxSettlementAmount(ledger(), 'A', 'B')).toBe(0))
  test('to a non-creditor is 0', () => expect(maxSettlementAmount(ledger(), 'B', 'C')).toBe(0))
  test('self is 0', () => expect(maxSettlementAmount(ledger(), 'A', 'A')).toBe(0))
  test('unknown users are 0', () => expect(maxSettlementAmount(ledger(), 'X', 'A')).toBe(0))
})

describe('settlementCap', () => {
  const nets = { A: 600, B: -300, C: -300 }
  test('min of debt and credit', () => expect(settlementCap(nets, 0, 'B', 'A')).toBe(300))
  test('minus pending outgoing', () => expect(settlementCap(nets, 100, 'B', 'A')).toBe(200))
  test('never negative', () => expect(settlementCap(nets, 500, 'B', 'A')).toBe(0))
  test('from a creditor, to a debtor, to yourself or between unknowns is 0', () => {
    expect(settlementCap(nets, 0, 'A', 'B')).toBe(0)
    expect(settlementCap(nets, 0, 'B', 'C')).toBe(0)
    expect(settlementCap({ A: -5, B: 5 }, 0, 'A', 'A')).toBe(0)
    expect(settlementCap(nets, 0, 'X', 'Y')).toBe(0)
  })
})

describe('isExpenseLocked', () => {
  test('confirmed, later, involves participant', () => expect(isExpenseLocked(exp900, [stl()])).toBe(true))
  test('involves only the payer', () =>
    expect(isExpenseLocked({ ...exp900, shares: [{ userId: 'B', amountCents: 900 }] }, [stl({ fromUserId: 'X', toUserId: 'A' })])).toBe(true))
  test('pending', () => expect(isExpenseLocked(exp900, [stl({ status: 'pending', resolvedAt: null })])).toBe(false))
  test('resolved before the expense', () =>
    expect(isExpenseLocked(exp900, [stl({ resolvedAt: '2025-12-31T00:00:00.000Z' })])).toBe(false))
  test('between outsiders', () =>
    expect(isExpenseLocked(exp900, [stl({ fromUserId: 'X', toUserId: 'Y' })])).toBe(false))
})
