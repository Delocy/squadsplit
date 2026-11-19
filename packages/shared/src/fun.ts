import type { Cents } from './money'
import { type Ledger, computeBalances } from './ledger'

export type BadgeKey = 'debt_goblin' | 'biggest_spender' | 'ghost' | 'bar_tab' | 'good_egg' | 'wheel_victim'
export interface Badge { key: BadgeKey; emoji: string; title: string; userId: string }

const BADGES: Record<BadgeKey, { emoji: string; title: string }> = {
  debt_goblin: { emoji: '👺', title: 'Debt Goblin' },
  biggest_spender: { emoji: '💸', title: 'Biggest Spender' },
  ghost: { emoji: '👻', title: 'Ghost' },
  bar_tab: { emoji: '🍻', title: 'Bar Tab Champion' },
  good_egg: { emoji: '🤝', title: 'Good Egg' },
  wheel_victim: { emoji: '🎰', title: 'Wheel Victim' },
}
const BAR_CATEGORY = '🍻'

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The one member with the highest positive score, or undefined on a tie or a top value of 0. */
function soleLeader(scores: Record<string, number>): string | undefined {
  let best = 0
  let leaders: string[] = []
  for (const [id, v] of Object.entries(scores)) {
    if (v > best) {
      best = v
      leaders = [id]
    } else if (v === best && v > 0) leaders.push(id)
  }
  return leaders.length === 1 ? leaders[0] : undefined
}

function tally(members: string[], items: Iterable<{ id: string; amount: number }>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(members.map((id) => [id, 0]))
  for (const { id, amount } of items) if (id in out) out[id] = (out[id] ?? 0) + amount
  return out
}

export function computeBadges(l: Ledger): Badge[] {
  const members = [...l.currentMemberIds].sort(byId)
  const net = computeBalances(l)
  const award = (key: BadgeKey, userId: string): Badge => ({ key, ...BADGES[key], userId })
  const out: Badge[] = []
  const push = (key: BadgeKey, scores: Record<string, number>) => {
    const id = soleLeader(scores)
    if (id !== undefined) out.push(award(key, id))
  }

  push('debt_goblin', Object.fromEntries(members.map((id) => [id, -(net[id] ?? 0)])))
  push('biggest_spender', tally(members, l.expenses.map((e) => ({ id: e.paidBy, amount: e.amountCents }))))

  const payers = new Set(l.expenses.map((e) => e.paidBy))
  const sharers = new Set(l.expenses.flatMap((e) => e.shares.map((s) => s.userId)))
  for (const id of members) if (sharers.has(id) && !payers.has(id)) out.push(award('ghost', id))

  push(
    'bar_tab',
    tally(members, l.expenses.filter((e) => e.category === BAR_CATEGORY).map((e) => ({ id: e.paidBy, amount: e.amountCents }))),
  )
  push(
    'good_egg',
    tally(members, l.settlements.filter((s) => s.status === 'confirmed').map((s) => ({ id: s.fromUserId, amount: 1 }))),
  )
  push('wheel_victim', tally(members, l.spins.map((s) => ({ id: s.winnerId, amount: 1 }))))
  return out
}

/** Current members by net balance, most owed first. Ties share a rank (1,1,3). */
export function computeLeaderboard(l: Ledger): { userId: string; netCents: Cents; rank: number }[] {
  const net = computeBalances(l)
  const rows = [...l.currentMemberIds]
    .sort(byId)
    .map((userId) => ({ userId, netCents: net[userId] ?? 0 }))
    .sort((a, b) => b.netCents - a.netCents)
  const ranked: { userId: string; netCents: Cents; rank: number }[] = []
  rows.forEach((r, i) => {
    const prev = ranked[i - 1]
    ranked.push({ ...r, rank: prev && prev.netCents === r.netCents ? prev.rank : i + 1 })
  })
  return ranked
}

/** weight = 1 + 3 * debt / maxDebt for current members; every weight is 1 when nobody owes anything. */
export function spinWeights(l: Ledger): Record<string, number> {
  const net = computeBalances(l)
  const debts = Object.fromEntries(l.currentMemberIds.map((id) => [id, Math.max(0, -(net[id] ?? 0))]))
  const maxDebt = Math.max(0, ...Object.values(debts))
  return Object.fromEntries(
    Object.entries(debts).map(([id, debt]) => [id, maxDebt === 0 ? 1 : 1 + (3 * debt) / maxDebt]),
  )
}

/** r in [0,1). Walks user ids in ascending order; returns the first whose cumulative weight exceeds r * total. */
export function pickWeighted(weights: Record<string, number>, r: number): string {
  const ids = Object.keys(weights).sort(byId)
  if (ids.length === 0) throw new Error('pickWeighted: no weights')
  const total = ids.reduce((sum, id) => sum + weights[id]!, 0)
  let acc = 0
  for (const id of ids) {
    acc += weights[id]!
    if (acc > r * total) return id
  }
  return ids[ids.length - 1]!
}
