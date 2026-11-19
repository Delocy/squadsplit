import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { isExpenseLocked, type BillItem, type Category, type Cents, type Currency, type ExpenseDTO } from '@squadsplit/shared'
import type { Db } from '.'
import { expenseItemUsers, expenseItems, expenseShares, expenses, settlements } from './schema'

type Statements = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]

/** The columns of an expense that a create or an edit sets from the request. */
export type ExpenseFields = Omit<typeof expenses.$inferInsert, 'id' | 'groupId' | 'createdBy' | 'createdAt' | 'updatedAt'>

/** Everything stored for one expense: its row, its shares, and its items (itemized only). */
export interface ExpenseWrite {
  fields: ExpenseFields
  shares: Record<string, Cents>
  items: BillItem[] | null
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(key(row))
    if (group) group.push(row)
    else groups.set(key(row), [row])
  }
  return groups
}

/**
 * A group's expenses (newest `spentOn` first, then newest `createdAt`), the one expense with that id
 * (an empty array if there is none), or the expenses with those ids (at most ~90, D1's parameter limit). `locked` is worked out against the group's confirmed settlements.
 */
export async function loadExpenses(d: Db, filter: { groupId: string } | { expenseId: string } | { expenseIds: string[] }): Promise<ExpenseDTO[]> {
  const where =
    'groupId' in filter
      ? eq(expenses.groupId, filter.groupId)
      : 'expenseId' in filter
        ? eq(expenses.id, filter.expenseId)
        : inArray(expenses.id, filter.expenseIds)
  const [rows, shareRows, itemRows, itemUserRows, settlementRows] = await d.batch([
    d
      .select()
      .from(expenses)
      .where(where)
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt), desc(expenses.id)),
    d
      .select({ expenseId: expenseShares.expenseId, userId: expenseShares.userId, amountCents: expenseShares.amountCents })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(where)
      .orderBy(asc(expenseShares.userId)),
    d
      .select({ id: expenseItems.id, expenseId: expenseItems.expenseId, name: expenseItems.name, amountCents: expenseItems.amountCents })
      .from(expenseItems)
      .innerJoin(expenses, eq(expenses.id, expenseItems.expenseId))
      .where(where)
      .orderBy(asc(expenseItems.position)),
    d
      .select({ itemId: expenseItemUsers.itemId, userId: expenseItemUsers.userId })
      .from(expenseItemUsers)
      .innerJoin(expenseItems, eq(expenseItems.id, expenseItemUsers.itemId))
      .innerJoin(expenses, eq(expenses.id, expenseItems.expenseId))
      .where(where)
      .orderBy(asc(expenseItemUsers.userId)),
    d
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
      .where(
        and(
          eq(settlements.status, 'confirmed'),
          inArray(settlements.groupId, d.select({ groupId: expenses.groupId }).from(expenses).where(where)),
        ),
      ),
  ])

  const sharesByExpense = groupBy(shareRows, (s) => s.expenseId)
  const itemsByExpense = groupBy(itemRows, (i) => i.expenseId)
  const usersByItem = groupBy(itemUserRows, (u) => u.itemId)

  return rows.map((e) => {
    const shares = (sharesByExpense.get(e.id) ?? []).map(({ userId, amountCents }) => ({ userId, amountCents }))
    const items =
      e.splitType === 'itemized'
        ? (itemsByExpense.get(e.id) ?? []).map((item) => ({
            name: item.name,
            amountCents: item.amountCents,
            userIds: (usersByItem.get(item.id) ?? []).map((u) => u.userId),
          }))
        : null
    return {
      id: e.id,
      groupId: e.groupId,
      description: e.description,
      amountCents: e.amountCents,
      paidBy: e.paidBy,
      createdBy: e.createdBy,
      category: e.category as Category,
      spentOn: e.spentOn,
      splitType: e.splitType,
      shares,
      currency: e.currency as Currency,
      fxRatePpm: e.fxRatePpm,
      serviceChargeBps: e.serviceChargeBps,
      gstBps: e.gstBps,
      items,
      locked: isExpenseLocked({ ...e, shares }, settlementRows),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }
  })
}

/** D1 binds at most 100 parameters per statement, so multi-row inserts are split to stay under it. */
const D1_MAX_PARAMS = 100

export function chunked<T extends object>(rows: T[]): T[][] {
  if (rows.length === 0) return []
  const size = Math.floor(D1_MAX_PARAMS / Object.keys(rows[0]!).length)
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  return chunks
}

/** Inserts for the shares and items of an expense whose row exists (or is inserted earlier in the same batch). */
function childInserts(d: Db, expenseId: string, write: ExpenseWrite): BatchItem<'sqlite'>[] {
  const shareRows = Object.entries(write.shares).map(([userId, amountCents]) => ({ expenseId, userId, amountCents }))
  const itemRows = (write.items ?? []).map((item, position) => ({
    id: crypto.randomUUID(),
    expenseId,
    position,
    name: item.name,
    amountCents: item.amountCents,
  }))
  const itemUserRows = (write.items ?? []).flatMap((item, i) => item.userIds.map((userId) => ({ itemId: itemRows[i]!.id, userId })))
  return [
    ...chunked(shareRows).map((rows) => d.insert(expenseShares).values(rows)),
    ...chunked(itemRows).map((rows) => d.insert(expenseItems).values(rows)),
    ...chunked(itemUserRows).map((rows) => d.insert(expenseItemUsers).values(rows)),
  ]
}

/** Statements that create an expense with its shares and items; run them in one `db.batch`. */
export function insertExpense(
  d: Db,
  expense: { id: string; groupId: string; createdBy: string; now: string },
  write: ExpenseWrite,
): Statements {
  const { id, groupId, createdBy, now } = expense
  return [
    d.insert(expenses).values({ id, groupId, createdBy, createdAt: now, updatedAt: now, ...write.fields }),
    ...childInserts(d, id, write),
  ]
}

/**
 * Statements that replace an expense's fields, shares and items (keeping `createdAt` and `createdBy`);
 * run them in one `db.batch`. Deleting the items cascades to their users.
 */
export function replaceExpense(d: Db, id: string, now: string, write: ExpenseWrite): Statements {
  return [
    d.update(expenses).set({ ...write.fields, updatedAt: now }).where(eq(expenses.id, id)),
    d.delete(expenseShares).where(eq(expenseShares.expenseId, id)),
    d.delete(expenseItems).where(eq(expenseItems.expenseId, id)),
    ...childInserts(d, id, write),
  ]
}
