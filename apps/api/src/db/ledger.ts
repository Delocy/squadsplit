import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Ledger, LedgerExpense } from '@squadsplit/shared'
import type { Db } from '.'
import { expenseShares, expenses, memberships, settlements, spins } from './schema'

/** Everything the shared money and fun logic needs about one group, oldest first. */
export async function loadLedger(db: Db, groupId: string): Promise<Ledger> {
  const [members, expenseRows, shareRows, settlementRows, spinRows] = await db.batch([
    db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt))),
    db
      .select({
        id: expenses.id,
        paidBy: expenses.paidBy,
        amountCents: expenses.amountCents,
        category: expenses.category,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(asc(expenses.createdAt), asc(expenses.id)),
    db
      .select({ expenseId: expenseShares.expenseId, userId: expenseShares.userId, amountCents: expenseShares.amountCents })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(eq(expenses.groupId, groupId))
      .orderBy(asc(expenseShares.userId)),
    db
      .select({
        id: settlements.id,
        fromUserId: settlements.fromUserId,
        toUserId: settlements.toUserId,
        amountCents: settlements.amountCents,
        status: settlements.status,
        createdAt: settlements.createdAt,
        resolvedAt: settlements.resolvedAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId))
      .orderBy(asc(settlements.createdAt), asc(settlements.id)),
    db
      .select({ winnerId: spins.winnerId, createdAt: spins.createdAt })
      .from(spins)
      .where(eq(spins.groupId, groupId))
      .orderBy(asc(spins.createdAt), asc(spins.id)),
  ])

  const sharesByExpense = new Map<string, LedgerExpense['shares']>()
  for (const { expenseId, userId, amountCents } of shareRows) {
    const shares = sharesByExpense.get(expenseId) ?? []
    shares.push({ userId, amountCents })
    sharesByExpense.set(expenseId, shares)
  }

  return {
    currentMemberIds: members.map((m) => m.userId),
    expenses: expenseRows.map((e) => ({ ...e, shares: sharesByExpense.get(e.id) ?? [] })),
    settlements: settlementRows,
    spins: spinRows,
  }
}
