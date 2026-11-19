import type { Cents } from './money'

export type SettlementStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'
export interface LedgerShare { userId: string; amountCents: Cents }
export interface LedgerExpense {
  id: string
  paidBy: string
  amountCents: Cents
  category: string
  createdAt: string
  shares: LedgerShare[]
}
export interface LedgerSettlement {
  id: string
  fromUserId: string
  toUserId: string
  amountCents: Cents
  status: SettlementStatus
  createdAt: string
  resolvedAt: string | null
}
export interface LedgerSpin { winnerId: string; createdAt: string }
export interface Ledger {
  currentMemberIds: string[]
  expenses: LedgerExpense[]
  settlements: LedgerSettlement[]
  spins: LedgerSpin[]
}
export interface Transfer { fromUserId: string; toUserId: string; amountCents: Cents }

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Net balance per user (confirmed settlements only). Includes current members and anyone in history. */
export function computeBalances(l: Ledger): Record<string, Cents> {
  const net: Record<string, Cents> = {}
  const add = (id: string, d: Cents) => {
    net[id] = (net[id] ?? 0) + d
  }
  for (const id of l.currentMemberIds) add(id, 0)
  for (const e of l.expenses) {
    add(e.paidBy, e.amountCents)
    for (const s of e.shares) add(s.userId, -s.amountCents)
  }
  for (const s of l.settlements) {
    if (s.status !== 'confirmed') continue
    add(s.fromUserId, s.amountCents)
    add(s.toUserId, -s.amountCents)
  }
  return net
}

/** Greedy: pair the largest debtor with the largest creditor; ties broken by user id. */
export function simplifyDebts(balances: Record<string, Cents>): Transfer[] {
  const debtors = Object.entries(balances).filter(([, v]) => v < 0).map(([id, v]) => ({ id, left: -v }))
  const creditors = Object.entries(balances).filter(([, v]) => v > 0).map(([id, v]) => ({ id, left: v }))
  const order = (a: { id: string; left: number }, b: { id: string; left: number }) => b.left - a.left || byId(a.id, b.id)
  const out: Transfer[] = []
  for (;;) {
    debtors.sort(order)
    creditors.sort(order)
    const d = debtors[0]
    const c = creditors[0]
    if (!d || !c) break
    const amount = Math.min(d.left, c.left)
    out.push({ fromUserId: d.id, toUserId: c.id, amountCents: amount })
    d.left -= amount
    c.left -= amount
    if (d.left === 0) debtors.shift()
    if (c.left === 0) creditors.shift()
  }
  return out
}

/** Largest amount `from` may newly settle to `to`: min(debt, credit) minus from's pending outgoing. */
export function maxSettlementAmount(l: Ledger, fromUserId: string, toUserId: string): Cents {
  if (fromUserId === toUserId) return 0
  const net = computeBalances(l)
  const pending = l.settlements
    .filter((s) => s.status === 'pending' && s.fromUserId === fromUserId)
    .reduce((sum, s) => sum + s.amountCents, 0)
  const cap = Math.min(-(net[fromUserId] ?? 0), net[toUserId] ?? 0) - pending
  return Math.max(0, cap)
}

/** Locked once a confirmed settlement involving the payer or a participant resolved after the expense was created. */
export function isExpenseLocked(e: LedgerExpense, settlements: LedgerSettlement[]): boolean {
  const people = new Set([e.paidBy, ...e.shares.map((s) => s.userId)])
  return settlements.some(
    (s) =>
      s.status === 'confirmed' &&
      s.resolvedAt !== null &&
      s.resolvedAt > e.createdAt &&
      (people.has(s.fromUserId) || people.has(s.toUserId)),
  )
}
