import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { defaultAvatar, firstFreeAvatar, type AvatarChoice, type PaidMarkedBy, type QuickSplitInput } from '@squadsplit/shared'
import type { Db } from '../db'
import { chunked } from '../db/expenses'
import { quickSplitItemPeople, quickSplitItems, quickSplitPeople, quickSplits } from '../db/schema'
import { HttpError } from '../errors'

// Reading and writing quick splits. A split is its row, its people (in the order entered; position 0 is the owner),
// and its dishes with who had each. Totals are never stored: see quickSplitBreakdown.

export type SplitRow = typeof quickSplits.$inferSelect
export type PersonRow = typeof quickSplitPeople.$inferSelect
export type ItemRow = typeof quickSplitItems.$inferSelect & { personIds: string[] }

export interface StoredSplit {
  split: SplitRow
  people: PersonRow[]
  items: ItemRow[]
}

type Statements = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]

/** The splits matching `where` (newest first) with their people and dishes, in four reads in one round trip. */
async function loadWhere(d: Db, where: SQL): Promise<StoredSplit[]> {
  const ids = d.select({ id: quickSplits.id }).from(quickSplits).where(where)
  const [splits, people, items, itemPeople] = await d.batch([
    d.select().from(quickSplits).where(where).orderBy(desc(quickSplits.createdAt), desc(sql`${quickSplits}.rowid`)),
    d.select().from(quickSplitPeople).where(inArray(quickSplitPeople.splitId, ids)).orderBy(asc(quickSplitPeople.position)),
    d.select().from(quickSplitItems).where(inArray(quickSplitItems.splitId, ids)).orderBy(asc(quickSplitItems.position)),
    d
      .select({ itemId: quickSplitItemPeople.itemId, personId: quickSplitItemPeople.personId, position: quickSplitPeople.position })
      .from(quickSplitItemPeople)
      .innerJoin(quickSplitPeople, eq(quickSplitPeople.id, quickSplitItemPeople.personId))
      .where(inArray(quickSplitPeople.splitId, ids))
      .orderBy(asc(quickSplitPeople.position)),
  ])
  return splits.map((split) => ({
    split,
    people: people.filter((p) => p.splitId === split.id),
    items: items
      .filter((it) => it.splitId === split.id)
      .map((it) => ({ ...it, personIds: itemPeople.filter((ip) => ip.itemId === it.id).map((ip) => ip.personId) })),
  }))
}

/** The caller's split, or 404: someone else's split is never revealed. */
export async function loadOwnSplit(d: Db, id: string, ownerId: string): Promise<StoredSplit> {
  const [found] = await loadWhere(d, and(eq(quickSplits.id, id), eq(quickSplits.ownerId, ownerId))!)
  if (!found) throw new HttpError(404, 'not_found', 'Quick split not found')
  return found
}

/** Every split the user owns, newest first. */
export const loadOwnSplits = (d: Db, ownerId: string) => loadWhere(d, eq(quickSplits.ownerId, ownerId))

/** The split a share token belongs to, if any (whether or not its link is still on). */
export async function loadSplitByToken(d: Db, token: string): Promise<StoredSplit | undefined> {
  const [found] = await loadWhere(d, eq(quickSplits.shareToken, token))
  return found
}

/** One person to save: who they are, their look and place, and whether they were already saved. */
interface PlannedPerson {
  id: string
  name: string
  avatar: AvatarChoice
  position: number
  isPayer: boolean
  kept: boolean
}

/**
 * Who the input says is in the split. People sent with an id must already be in it (`existing`), else 422
 * unknown_person; they keep their look unless the input brings one. Looks are unique within the split: people with a
 * look in mind (asked for, already theirs, or, for a new first person, the owner's profile look) are placed first,
 * then everyone else from their default, each moving on to the first free look if it is taken.
 */
export function planPeople(input: QuickSplitInput, existing: PersonRow[], ownerLook: AvatarChoice): PlannedPerson[] {
  const saved = new Map(existing.map((p) => [p.id, p]))
  const drafts = input.people.map((p, position) => {
    if (p.id !== undefined && !saved.has(p.id)) throw new HttpError(422, 'unknown_person', 'That person is not in this quick split.')
    const before = p.id === undefined ? undefined : saved.get(p.id)
    const id = before?.id ?? crypto.randomUUID()
    const stored = before && lookOf(before)
    const wanted = p.avatar ?? stored ?? (position === 0 && !before ? ownerLook : undefined)
    return { id, name: p.name, position, isPayer: p.isPayer, kept: before !== undefined, wanted, avatar: undefined as AvatarChoice | undefined }
  })
  const taken: AvatarChoice[] = []
  const place = (preferred: AvatarChoice) => {
    const avatar = firstFreeAvatar(preferred, taken)
    taken.push(avatar)
    return avatar
  }
  for (const p of drafts) if (p.wanted) p.avatar = place(p.wanted)
  for (const p of drafts) if (!p.avatar) p.avatar = place(defaultAvatar(p.id))
  return drafts.map(({ wanted: _wanted, avatar, ...p }) => ({ ...p, avatar: avatar! }))
}

const personRow = (splitId: string, p: PlannedPerson) => ({
  id: p.id, splitId, name: p.name, animal: p.avatar.animal, color: p.avatar.color, position: p.position, isPayer: p.isPayer,
})

/** Inserts for the dishes and who had each, people given by their place in `people`. */
function itemInserts(d: Db, splitId: string, input: QuickSplitInput, people: PlannedPerson[]): BatchItem<'sqlite'>[] {
  const items = input.items.map((it, position) => ({ id: crypto.randomUUID(), splitId, name: it.name, amountCents: it.amountCents, position }))
  const itemPeople = input.items.flatMap((it, i) => it.personIndexes.map((index) => ({ itemId: items[i]!.id, personId: people[index]!.id })))
  return [
    ...chunked(items).map((rows) => d.insert(quickSplitItems).values(rows)),
    ...chunked(itemPeople).map((rows) => d.insert(quickSplitItemPeople).values(rows)),
  ]
}

const splitFields = (input: QuickSplitInput) => ({
  title: input.title,
  place: input.place,
  spentOn: input.spentOn,
  serviceChargeBps: input.serviceChargeBps,
  gstBps: input.gstBps,
})

/** Statements that create a split with its people, dishes and share link; run them in one `db.batch`. */
export function insertSplit(
  d: Db,
  split: { id: string; ownerId: string; now: string; shareToken: string; shareExpiresAt: string },
  input: QuickSplitInput,
  people: PlannedPerson[],
): Statements {
  const { id, ownerId, now, shareToken, shareExpiresAt } = split
  return [
    d.insert(quickSplits).values({ id, ownerId, ...splitFields(input), shareToken, shareExpiresAt, createdAt: now, updatedAt: now }),
    ...chunked(people.map((p) => personRow(id, p))).map((rows) => d.insert(quickSplitPeople).values(rows)),
    ...itemInserts(d, id, input, people),
  ]
}

/**
 * Statements that replace a split's fields, people and dishes; run them in one `db.batch`. Kept people keep their
 * ticks (unless they become the payer, who is never ticked); people left out are deleted. The payer flag is cleared
 * on everyone first, so moving it never trips the one-payer index.
 */
export function replaceSplit(d: Db, splitId: string, now: string, input: QuickSplitInput, people: PlannedPerson[]): Statements {
  const kept = people.filter((p) => p.kept)
  const ofSplit = eq(quickSplitPeople.splitId, splitId)
  return [
    d.update(quickSplits).set({ ...splitFields(input), updatedAt: now }).where(eq(quickSplits.id, splitId)),
    d.delete(quickSplitItems).where(eq(quickSplitItems.splitId, splitId)),
    d.delete(quickSplitPeople).where(kept.length ? and(ofSplit, notInArray(quickSplitPeople.id, kept.map((p) => p.id))) : ofSplit),
    d.update(quickSplitPeople).set({ isPayer: false }).where(ofSplit),
    ...kept.map((p) => {
      const { id: _id, splitId: _splitId, ...fields } = personRow(splitId, p)
      return d
        .update(quickSplitPeople)
        .set(p.isPayer ? { ...fields, paidAt: null, paidMarkedBy: null } : fields)
        .where(and(ofSplit, eq(quickSplitPeople.id, p.id)))
    }),
    ...chunked(people.filter((p) => !p.kept).map((p) => personRow(splitId, p))).map((rows) => d.insert(quickSplitPeople).values(rows)),
    ...itemInserts(d, splitId, input, people),
  ]
}

/**
 * Ticks or unticks someone (never the payer: the caller checks). Ticking someone already ticked keeps the first
 * time and who ticked.
 */
export async function markPaid(d: Db, person: PersonRow, paid: boolean, by: PaidMarkedBy, now: string): Promise<void> {
  const row = and(eq(quickSplitPeople.id, person.id), eq(quickSplitPeople.isPayer, false))
  if (paid) await d.update(quickSplitPeople).set({ paidAt: now, paidMarkedBy: by }).where(and(row, isNull(quickSplitPeople.paidAt)))
  else await d.update(quickSplitPeople).set({ paidAt: null, paidMarkedBy: null }).where(row)
}

/** The person in the split, or 404; 422 payer_paid for the payer, who paid the bill and is never ticked. */
export function guestToTick(s: StoredSplit, personId: string): PersonRow {
  const person = s.people.find((p) => p.id === personId)
  if (!person) throw new HttpError(404, 'not_found', 'That person is not in this quick split.')
  if (person.isPayer) throw new HttpError(422, 'payer_paid', 'The payer paid the bill, so there is nothing to tick.')
  return person
}

/** Turns the share link off for good; stopping it again keeps the first time. */
export function stopSharing(d: Db, splitId: string, now: string) {
  return d.update(quickSplits).set({ shareRevokedAt: now }).where(and(eq(quickSplits.id, splitId), isNull(quickSplits.shareRevokedAt)))
}

export const deleteSplit = (d: Db, splitId: string) => d.delete(quickSplits).where(eq(quickSplits.id, splitId))

/** A saved person's look. */
export const lookOf = (p: Pick<PersonRow, 'animal' | 'color'>): AvatarChoice => ({ animal: p.animal, color: p.color }) as AvatarChoice
