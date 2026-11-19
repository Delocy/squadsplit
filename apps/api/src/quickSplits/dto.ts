import {
  quickSplitBreakdown,
  type Currency,
  type PublicQuickSplitDTO,
  type QuickSplitBreakdown,
  type QuickSplitDTO,
  type QuickSplitSummaryDTO,
} from '@squadsplit/shared'
import { linkState } from './shareLink'
import { lookOf, type StoredSplit } from './store'

/** The totals, worked out from the stored dishes with the shared maths (they were checked when saved). */
function breakdownOf(s: StoredSplit): QuickSplitBreakdown {
  return quickSplitBreakdown({
    people: s.people.map((p) => ({ id: p.id, isPayer: p.isPayer })),
    items: s.items.map((it) => ({ name: it.name, amountCents: it.amountCents, personIds: it.personIds })),
    serviceChargeBps: s.split.serviceChargeBps ?? 0,
    gstBps: s.split.gstBps ?? 0,
  })
}

const payerOf = (s: StoredSplit) => s.people.find((p) => p.isPayer)!

/** The bill's fields both views share. */
function billFields(s: StoredSplit, b: QuickSplitBreakdown) {
  return {
    title: s.split.title,
    place: s.split.place,
    spentOn: s.split.spentOn,
    currency: s.split.currency as Currency,
    serviceChargeBps: s.split.serviceChargeBps ?? 0,
    gstBps: s.split.gstBps ?? 0,
    subtotalCents: b.subtotalCents,
    serviceChargeCents: b.serviceChargeCents,
    gstCents: b.gstCents,
    totalCents: b.totalCents,
  }
}

/** A person's paid state: the payer is never ticked. */
const paidOf = (p: StoredSplit['people'][number]) => (p.isPayer ? { paidAt: null, paidMarkedBy: null } : { paidAt: p.paidAt, paidMarkedBy: p.paidMarkedBy })

/** The owner's view. */
export function quickSplitDTO(s: StoredSplit, now = new Date()): QuickSplitDTO {
  const b = breakdownOf(s)
  return {
    id: s.split.id,
    ...billFields(s, b),
    payerId: payerOf(s).id,
    people: s.people.map((p) => ({ id: p.id, name: p.name, avatar: lookOf(p), isPayer: p.isPayer, ...b.people[p.id]!, ...paidOf(p) })),
    items: s.items.map((it) => ({ id: it.id, name: it.name, amountCents: it.amountCents, personIds: it.personIds })),
    share: {
      token: s.split.shareToken ?? '',
      expiresAt: s.split.shareExpiresAt ?? '',
      revokedAt: s.split.shareRevokedAt,
      state: linkState(s.split, now),
    },
    createdAt: s.split.createdAt,
    updatedAt: s.split.updatedAt,
  }
}

/** A row of the owner's list. The payer counts as paid. */
export function quickSplitSummary(s: StoredSplit, now = new Date()): QuickSplitSummaryDTO {
  return {
    id: s.split.id,
    title: s.split.title,
    place: s.split.place,
    spentOn: s.split.spentOn,
    currency: s.split.currency as Currency,
    totalCents: breakdownOf(s).totalCents,
    paidCount: s.people.filter((p) => p.isPayer || p.paidAt !== null).length,
    peopleCount: s.people.length,
    link: linkState(s.split, now),
    names: s.people.map((p) => p.name),
    createdAt: s.split.createdAt,
  }
}

/** The public view behind the share link: names and amounts only. Built field by field, so nothing else slips in. */
export function publicQuickSplitDTO(s: StoredSplit): PublicQuickSplitDTO {
  const b = breakdownOf(s)
  const payer = payerOf(s)
  return {
    ...billFields(s, b),
    payerId: payer.id,
    payerName: payer.name,
    people: s.people.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: lookOf(p),
      dishes: b.people[p.id]!.dishes,
      totalCents: b.people[p.id]!.totalCents,
      ...paidOf(p),
    })),
  }
}

/** Who to ask when the link is off. */
export const payerNameOf = (s: StoredSplit) => payerOf(s).name
