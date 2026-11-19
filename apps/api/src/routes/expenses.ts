import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  computeBalances,
  CreateExpenseInput,
  simplifyDebts,
  splitEqual,
  splitItemized,
  SplitError,
  UpdateExpenseInput,
  type BalancesDTO,
  type Cents,
  type ExpenseDTO,
} from '@squadsplit/shared'
import { requireMember } from '../access'
import { db, type Db } from '../db'
import { insertExpense, loadExpenses, replaceExpense, type ExpenseWrite } from '../db/expenses'
import { loadLedger } from '../db/ledger'
import { expenses, groups, memberships } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError, parseBody } from '../errors'

/** v1 has one currency per group, so every expense is stored at a 1:1 exchange rate. */
const PAR_FX_RATE_PPM = 1_000_000

type Split = CreateExpenseInput['split']

/** Everyone the split puts a share on. */
function participantsOf(split: Split): string[] {
  switch (split.type) {
    case 'equal':
      return split.participantIds
    case 'exact':
      return split.shares.map((s) => s.userId)
    case 'itemized':
      return [...new Set(split.items.flatMap((item) => item.userIds))]
  }
}

function sharesOf({ amountCents, paidBy, split }: CreateExpenseInput): Record<string, Cents> {
  try {
    switch (split.type) {
      case 'equal':
        return splitEqual(amountCents, split.participantIds, paidBy)
      case 'exact':
        return Object.fromEntries(split.shares.map((s) => [s.userId, s.amountCents]))
      case 'itemized':
        return splitItemized(split, paidBy)
    }
  } catch (err) {
    if (err instanceof SplitError) {
      throw new HttpError(422, 'amount_too_small', 'The amount is too small to split between that many people')
    }
    throw err
  }
}

/** Checks the input against the group (currency, current members) and works out what to store. */
async function prepareWrite(d: Db, groupId: string, input: CreateExpenseInput): Promise<ExpenseWrite> {
  const [[group], members] = await d.batch([
    d.select({ currency: groups.currency }).from(groups).where(eq(groups.id, groupId)).limit(1),
    d
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt))),
  ])
  if (!group) throw new HttpError(404, 'not_found', 'Group not found')

  const currency = input.currency ?? group.currency
  if (currency !== group.currency) {
    throw new HttpError(422, 'currency_mismatch', `Expenses in this group must be in ${group.currency}`)
  }

  const { split } = input
  const activeIds = new Set(members.map((m) => m.userId))
  if (![input.paidBy, ...participantsOf(split)].every((id) => activeIds.has(id))) {
    throw new HttpError(422, 'not_a_member', 'The payer and everyone in the split must be current members of the group')
  }

  const itemized = split.type === 'itemized' ? split : null
  return {
    fields: {
      description: input.description,
      amountCents: input.amountCents,
      paidBy: input.paidBy,
      category: input.category,
      spentOn: input.spentOn,
      splitType: split.type,
      currency,
      fxRatePpm: PAR_FX_RATE_PPM,
      serviceChargeBps: itemized?.serviceChargeBps ?? null,
      gstBps: itemized?.gstBps ?? null,
    },
    shares: sharesOf(input),
    items: itemized?.items ?? null,
  }
}

async function loadExpense(d: Db, expenseId: string): Promise<ExpenseDTO> {
  const [expense] = await loadExpenses(d, { expenseId })
  if (!expense) throw new HttpError(404, 'not_found', 'Expense not found')
  return expense
}

/** The expense, if the caller may change it now: 404 for non-members, 403 unless creator or owner, 409 when locked. */
async function changeableExpense(d: Db, expenseId: string, userId: string): Promise<ExpenseDTO> {
  const expense = await loadExpense(d, expenseId)
  const { role } = await requireMember(d, expense.groupId, userId)
  if (expense.createdBy !== userId && role !== 'owner') {
    throw new HttpError(403, 'forbidden', 'Only the person who logged the expense or the group owner can change it')
  }
  if (expense.locked) {
    throw new HttpError(409, 'expense_locked', 'A settlement has been confirmed since this expense was logged, so it is locked')
  }
  return expense
}

/** Routes under /groups/:id: the group's expenses and balances. */
export function groupExpenseRoutes() {
  return new Hono<AppEnv>()
    .get('/:id/expenses', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      return c.json(await loadExpenses(d, { groupId }))
    })

    .post('/:id/expenses', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      const write = await prepareWrite(d, groupId, await parseBody(c, CreateExpenseInput))
      const id = crypto.randomUUID()
      await d.batch(insertExpense(d, { id, groupId, createdBy: c.var.userId, now: new Date().toISOString() }, write))
      return c.json(await loadExpense(d, id), 201)
    })

    .get('/:id/balances', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      const balances = computeBalances(await loadLedger(d, groupId))
      return c.json<BalancesDTO>({ balances, suggestions: simplifyDebts(balances) })
    })
}

/** Routes under /expenses/:id. */
export function expenseRoutes() {
  return new Hono<AppEnv>()
    .patch('/:id', async (c) => {
      const d = db(c.env)
      const { id, groupId } = await changeableExpense(d, c.req.param('id'), c.var.userId)
      const write = await prepareWrite(d, groupId, await parseBody(c, UpdateExpenseInput))
      await d.batch(replaceExpense(d, id, new Date().toISOString(), write))
      return c.json(await loadExpense(d, id))
    })

    .delete('/:id', async (c) => {
      const d = db(c.env)
      const { id } = await changeableExpense(d, c.req.param('id'), c.var.userId)
      await d.delete(expenses).where(eq(expenses.id, id))
      return c.body(null, 204)
    })
}
