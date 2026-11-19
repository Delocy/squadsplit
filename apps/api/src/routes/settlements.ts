import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { CreateSettlementInput, ListSettlementsQuery, maxSettlementAmount } from '@squadsplit/shared'
import { findActiveRole, requireMember } from '../access'
import { db, type Db } from '../db'
import { loadLedger } from '../db/ledger'
import { settlements, users } from '../db/schema'
import { toSettlementDTO } from '../db/settlements'
import type { AppEnv } from '../env'
import { HttpError, parseBody } from '../errors'

/** Who may move a pending settlement to which status: the creditor confirms or rejects, the debtor cancels. */
const TRANSITIONS = {
  confirm: { status: 'confirmed', party: 'toUserId', who: 'the person being paid' },
  reject: { status: 'rejected', party: 'toUserId', who: 'the person being paid' },
  cancel: { status: 'cancelled', party: 'fromUserId', who: 'the person paying' },
} as const

/**
 * Moves a pending settlement on: 404 if it is unknown or the caller is not a member of its group,
 * 403 for the wrong party, 409 once it is no longer pending. The update only applies while the row
 * is still pending, so two racing transitions cannot both succeed.
 */
async function transition(d: Db, settlementId: string, userId: string, action: keyof typeof TRANSITIONS) {
  const { status, party, who } = TRANSITIONS[action]
  const settlement = await d.select().from(settlements).where(eq(settlements.id, settlementId)).get()
  if (!settlement) throw new HttpError(404, 'not_found', 'Settlement not found')
  await requireMember(d, settlement.groupId, userId)
  if (settlement[party] !== userId) throw new HttpError(403, 'forbidden', `Only ${who} can ${action} this settlement`)

  const [updated] = await d
    .update(settlements)
    .set({ status, resolvedAt: new Date().toISOString() })
    .where(and(eq(settlements.id, settlementId), eq(settlements.status, 'pending')))
    .returning()
  if (!updated) throw new HttpError(409, 'not_pending', 'This settlement is no longer pending')
  return toSettlementDTO(updated)
}

/** Which of the given users are placeholders (names in a group for someone who hasn't joined). */
async function placeholdersAmong(d: Db, userIds: string[]): Promise<Set<string>> {
  const rows = await d
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.kind, 'placeholder')))
  return new Set(rows.map((r) => r.id))
}

/** Routes under /groups/:id: start and list the group's settlements. */
export function groupSettlementRoutes() {
  return new Hono<AppEnv>()
    .get('/:id/settlements', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      const { status } = ListSettlementsQuery.parse(c.req.query())
      const rows = await d
        .select()
        .from(settlements)
        .where(and(eq(settlements.groupId, groupId), status ? eq(settlements.status, status) : undefined))
        .orderBy(desc(settlements.createdAt), desc(settlements.id))
      return c.json(rows.map(toSettlementDTO))
    })

    .post('/:id/settlements', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const me = c.var.userId
      await requireMember(d, groupId, me)
      const { fromUserId = me, toUserId, amountCents } = await parseBody(c, CreateSettlementInput)
      if (toUserId === fromUserId) throw new HttpError(422, 'self_settlement', 'You cannot settle up with yourself')
      for (const party of [fromUserId, toUserId]) {
        if (!(await findActiveRole(d, groupId, party))) {
          throw new HttpError(422, 'not_a_member', 'You can only settle up with a current member of the group')
        }
      }
      const placeholders = await placeholdersAmong(d, [fromUserId, toUserId])
      if (placeholders.size === 2) {
        throw new HttpError(422, 'placeholder_to_placeholder', "Two people who haven't joined yet can't settle up with each other")
      }
      // Usually you are the one paying. Only the person being paid can record that someone who hasn't joined paid them.
      if (fromUserId !== me && !(placeholders.has(fromUserId) && toUserId === me)) {
        throw new HttpError(422, 'not_your_payment', "You can only record what you paid, or what someone who hasn't joined yet paid you")
      }
      const max = maxSettlementAmount(await loadLedger(d, groupId), fromUserId, toUserId)
      if (amountCents > max) {
        throw new HttpError(409, 'exceeds_debt', `You can settle at most ${max} cents with this member right now`)
      }

      const now = new Date().toISOString()
      const [created] = await d
        .insert(settlements)
        .values({
          id: crypto.randomUUID(),
          groupId,
          fromUserId,
          toUserId,
          amountCents,
          // Someone who hasn't joined can't confirm, so a payment with them counts straight away.
          ...(placeholders.size > 0 ? { status: 'confirmed', resolvedAt: now } : { status: 'pending', resolvedAt: null }),
          createdAt: now,
        })
        .returning()
      return c.json(toSettlementDTO(created!), 201)
    })
}

/** Routes under /settlements/:id: the creditor confirms or rejects, the debtor cancels. */
export function settlementRoutes() {
  return new Hono<AppEnv>()
    .post('/:id/confirm', async (c) => c.json(await transition(db(c.env), c.req.param('id'), c.var.userId, 'confirm')))
    .post('/:id/reject', async (c) => c.json(await transition(db(c.env), c.req.param('id'), c.var.userId, 'reject')))
    .post('/:id/cancel', async (c) => c.json(await transition(db(c.env), c.req.param('id'), c.var.userId, 'cancel')))
}
