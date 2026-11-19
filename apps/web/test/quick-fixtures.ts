import { quickSplitBreakdown, SG_PRESET, type AvatarChoice, type PublicQuickSplitDTO, type QuickSplitDTO } from '@squadsplit/shared'

// The README's worked example as the API returns it: Dan (you) paid; Wei Ling and Arjun owe.
const LOOKS: Record<string, AvatarChoice> = {
  dan: { animal: 'fox', color: 'peach' },
  weiling: { animal: 'koala', color: 'lilac' },
  arjun: { animal: 'penguin', color: 'mint' },
}
const NAMES: Record<string, string> = { dan: 'Dan', weiling: 'Wei Ling', arjun: 'Arjun' }
const ITEMS = [
  { id: 'i1', name: 'Laksa', amountCents: 1000, personIds: ['weiling'] },
  { id: 'i2', name: 'Satay', amountCents: 2000, personIds: ['dan', 'weiling', 'arjun'] },
  { id: 'i3', name: 'Chilli crab', amountCents: 4800, personIds: ['dan', 'weiling', 'arjun'] },
  { id: 'i4', name: 'Char kway teow', amountCents: 850, personIds: ['arjun'] },
  { id: 'i5', name: 'Iced barley (2)', amountCents: 560, personIds: ['dan', 'arjun'] },
]

/** The README split, owner's view; `over` changes the bill's fields, `paid` ticks people (id → [time, by]). */
export function readmeSplit(over: Partial<QuickSplitDTO> = {}, paid: Record<string, [string, 'guest' | 'payer']> = {}): QuickSplitDTO {
  const charges = { serviceChargeBps: over.serviceChargeBps ?? SG_PRESET.serviceChargeBps, gstBps: over.gstBps ?? SG_PRESET.gstBps }
  const ids = Object.keys(NAMES)
  const b = quickSplitBreakdown({ people: ids.map((id) => ({ id, isPayer: id === 'dan' })), items: ITEMS, ...charges })
  return {
    id: 'q1',
    title: 'Team lunch',
    place: 'Tanjong Pagar',
    spentOn: '2026-11-19',
    currency: 'SGD',
    ...charges,
    subtotalCents: b.subtotalCents,
    serviceChargeCents: b.serviceChargeCents,
    gstCents: b.gstCents,
    totalCents: b.totalCents,
    payerId: 'dan',
    people: ids.map((id) => ({
      id,
      name: NAMES[id]!,
      avatar: LOOKS[id]!,
      isPayer: id === 'dan',
      ...b.people[id]!,
      paidAt: paid[id]?.[0] ?? null,
      paidMarkedBy: paid[id]?.[1] ?? null,
    })),
    items: ITEMS,
    share: { token: 'tok_7fK2qaAAAAAAAAAAAAAA', expiresAt: '2027-01-18T00:00:00.000Z', revokedAt: null, state: 'on' },
    createdAt: '2026-11-19T05:00:00.000Z',
    updatedAt: '2026-11-19T05:00:00.000Z',
    ...over,
  }
}

/** The same split as the share link shows it. */
export function readmePublic(paid: Record<string, [string, 'guest' | 'payer']> = {}): PublicQuickSplitDTO {
  const { id: _id, items: _items, share: _share, createdAt: _c, updatedAt: _u, people, ...bill } = readmeSplit({}, paid)
  return {
    ...bill,
    payerName: 'Dan',
    people: people.map(({ isPayer: _isPayer, ...p }) => p),
  }
}
