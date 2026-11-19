import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { FeedItem, SpinDTO } from '@squadsplit/shared'
import type { Db } from '.'
import { loadExpenses } from './expenses'
import { expenses, memberships, settlements, spins, users } from './schema'
import { toSettlementDTO } from './settlements'

export const FEED_LIMIT = 50

type SpinRow = typeof spins.$inferSelect

export const toSpinDTO = (s: SpinRow): SpinDTO => ({
  id: s.id,
  groupId: s.groupId,
  spunBy: s.spunBy,
  winnerId: s.winnerId,
  weights: JSON.parse(s.weightsJson) as Record<string, number>,
  createdAt: s.createdAt,
})

const TYPE_ORDER: Record<FeedItem['type'], number> = { expense: 0, settlement: 1, spin: 2, join: 3 }

const itemId = (i: FeedItem) =>
  i.type === 'expense' ? i.expense.id : i.type === 'settlement' ? i.settlement.id : i.type === 'spin' ? i.spin.id : i.userId

/** Newest `at` first; ties go expense, settlement, spin, join, then by id (descending, like every source query). */
const newestFirst = (a: FeedItem, b: FeedItem) =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (itemId(a) < itemId(b) ? 1 : itemId(a) > itemId(b) ? -1 : 0)

/**
 * The group's latest activity, newest first. Each source is read newest-first with its own limit, so the
 * work stays bounded however long the history is, and the merged list is then cut to the limit.
 */
export async function loadFeed(d: Db, groupId: string): Promise<FeedItem[]> {
  const [expenseIds, settlementRows, spinRows, joinRows] = await d.batch([
    d
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.createdAt), desc(expenses.id))
      .limit(FEED_LIMIT),
    d
      .select()
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), eq(settlements.status, 'confirmed'), isNotNull(settlements.resolvedAt)))
      .orderBy(desc(settlements.resolvedAt), desc(settlements.id))
      .limit(FEED_LIMIT),
    d.select().from(spins).where(eq(spins.groupId, groupId)).orderBy(desc(spins.createdAt), desc(spins.id)).limit(FEED_LIMIT),
    d
      .select({ userId: memberships.userId, joinedAt: memberships.joinedAt })
      .from(memberships)
      // A name added for someone who hasn't joined isn't a join; claiming it is (the membership's joined_at moves then),
      // with an account or as a guest. A guest signing in again after a reset keeps their first join.
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupId, groupId), inArray(users.kind, ['person', 'guest'])))
      .orderBy(desc(memberships.joinedAt), desc(memberships.userId))
      .limit(FEED_LIMIT),
  ])
  const expenseDTOs = expenseIds.length ? await loadExpenses(d, { expenseIds: expenseIds.map((e) => e.id) }) : []

  const items: FeedItem[] = [
    ...expenseDTOs.map((expense): FeedItem => ({ type: 'expense', at: expense.createdAt, expense })),
    ...settlementRows.map((s): FeedItem => ({ type: 'settlement', at: s.resolvedAt!, settlement: toSettlementDTO(s) })),
    ...spinRows.map((s): FeedItem => ({ type: 'spin', at: s.createdAt, spin: toSpinDTO(s) })),
    ...joinRows.map((j): FeedItem => ({ type: 'join', at: j.joinedAt, userId: j.userId })),
  ]
  return items.sort(newestFirst).slice(0, FEED_LIMIT)
}
