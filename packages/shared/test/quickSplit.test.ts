import { describe, expect, it } from 'vitest'
import {
  QUICK_SPLIT_MAX_ITEMS,
  QUICK_SPLIT_MAX_PEOPLE,
  QuickSplitInput,
  SG_PRESET,
  SplitError,
  quickSplitBreakdown,
  type QuickSplitBill,
} from '../src/index'

// The worked example from the approved mockups (docs/design/explorations/README.md, "1. Quick split").
const README_BILL: QuickSplitBill = {
  people: [
    { id: 'dan', isPayer: true },
    { id: 'weiling', isPayer: false },
    { id: 'arjun', isPayer: false },
  ],
  items: [
    { name: 'Laksa', amountCents: 1000, personIds: ['weiling'] },
    { name: 'Satay', amountCents: 2000, personIds: ['dan', 'weiling', 'arjun'] },
    { name: 'Chilli crab', amountCents: 4800, personIds: ['dan', 'weiling', 'arjun'] },
    { name: 'Char kway teow', amountCents: 850, personIds: ['arjun'] },
    { name: 'Iced barley (2)', amountCents: 560, personIds: ['dan', 'arjun'] },
  ],
  ...SG_PRESET,
}

describe('quickSplitBreakdown', () => {
  it('works the README example out to the cent: $92.10 + $9.21 + $9.12 = $110.43', () => {
    const b = quickSplitBreakdown(README_BILL)
    expect(b).toMatchObject({ subtotalCents: 9210, serviceChargeCents: 921, gstCents: 912, totalCents: 11043 })
    expect(b.people.dan!.totalCents).toBe(3055)
    expect(b.people.weiling!.totalCents).toBe(3916)
    expect(b.people.arjun!.totalCents).toBe(4072)
    expect(3055 + 3916 + 4072).toBe(11043)
  })

  it("lists each person's dishes with their part of each, the payer taking a shared dish's spare cent", () => {
    const b = quickSplitBreakdown(README_BILL)
    expect(b.people.dan!.dishes).toEqual([
      { name: 'Satay', shareCents: 668, sharedBy: 3 },
      { name: 'Chilli crab', shareCents: 1600, sharedBy: 3 },
      { name: 'Iced barley (2)', shareCents: 280, sharedBy: 2 },
    ])
    expect(b.people.weiling!.dishes).toEqual([
      { name: 'Laksa', shareCents: 1000, sharedBy: 1 },
      { name: 'Satay', shareCents: 666, sharedBy: 3 },
      { name: 'Chilli crab', shareCents: 1600, sharedBy: 3 },
    ])
  })

  it('gives someone without a dish nothing to pay', () => {
    const b = quickSplitBreakdown({ ...README_BILL, people: [...README_BILL.people, { id: 'priya', isPayer: false }] })
    expect(b.people.priya).toEqual({ totalCents: 0, dishes: [] })
  })

  it('takes each charge on its own: GST only on $10.00 is $10.90, service only is $11.00', () => {
    const tenDollars = (serviceChargeBps: number, gstBps: number): QuickSplitBill => ({
      people: [{ id: 'dan', isPayer: true }, { id: 'arjun', isPayer: false }],
      items: [{ name: 'Laksa', amountCents: 1000, personIds: ['arjun'] }],
      serviceChargeBps,
      gstBps,
    })
    expect(quickSplitBreakdown(tenDollars(0, 900))).toMatchObject({ serviceChargeCents: 0, gstCents: 90, totalCents: 1090 })
    expect(quickSplitBreakdown(tenDollars(1000, 0))).toMatchObject({ serviceChargeCents: 100, gstCents: 0, totalCents: 1100 })
    expect(quickSplitBreakdown(tenDollars(1000, 900)).totalCents).toBe(1199)
  })

  it('adds no charges when both rates are 0', () => {
    const b = quickSplitBreakdown({ ...README_BILL, serviceChargeBps: 0, gstBps: 0 })
    expect(b).toMatchObject({ subtotalCents: 9210, serviceChargeCents: 0, gstCents: 0, totalCents: 9210 })
  })

  it("gives a shared dish's spare cent by entry order, never by id, so the preview and the saved split agree", () => {
    // Teh tarik $3.25 shared by two guests: one of them gets the odd cent. Draft keys sort one way, UUIDs the other.
    const tehTarik = (ids: [string, string, string]): QuickSplitBill => ({
      people: [
        { id: ids[0], isPayer: true },
        { id: ids[1], isPayer: false },
        { id: ids[2], isPayer: false },
      ],
      items: [
        { name: 'Laksa', amountCents: 1000, personIds: [ids[0]] },
        { name: 'Teh tarik', amountCents: 325, personIds: [ids[1], ids[2]] },
      ],
      ...SG_PRESET,
    })
    const inOrder = (ids: [string, string, string]) => {
      const b = quickSplitBreakdown(tehTarik(ids))
      return ids.map((id) => [b.people[id]!.totalCents, b.people[id]!.dishes])
    }
    const draft = inOrder(['p1', 'p2', 'p3'])
    const saved = inOrder(['5f0c2a4e-0000-4000-8000-000000000000', 'f3a1b2c3-0000-4000-8000-000000000000', '0b9e8d7c-0000-4000-8000-000000000000'])
    expect(saved).toEqual(draft)
    // The first of the two (Wei Ling) takes the spare cent: 163¢ of tea for her, 162¢ for Arjun.
    expect(draft[1]![1]).toEqual([{ name: 'Teh tarik', shareCents: 163, sharedBy: 2 }])
    expect(draft[2]![1]).toEqual([{ name: 'Teh tarik', shareCents: 162, sharedBy: 2 }])
  })

  it('throws SplitError for a dish with fewer cents than the people sharing it, even when everyone has other dishes', () => {
    const mint = { name: 'Mint', amountCents: 1, personIds: ['weiling', 'arjun'] }
    expect(() => quickSplitBreakdown({ ...README_BILL, items: [...README_BILL.items, mint] })).toThrow(SplitError)
    expect(quickSplitBreakdown({ ...README_BILL, items: [...README_BILL.items, { ...mint, amountCents: 2 }] }).totalCents).toBe(11045)
  })

  it('throws SplitError when a dish is too small to give everyone a cent', () => {
    expect(() =>
      quickSplitBreakdown({ ...README_BILL, items: [{ name: 'Mint', amountCents: 1, personIds: ['weiling', 'arjun'] }] }),
    ).toThrow(SplitError)
  })
})

const person = (name: string, isPayer = false) => ({ name, isPayer })
const valid = {
  title: 'Team lunch',
  place: 'Tanjong Pagar',
  spentOn: '2026-11-19',
  ...SG_PRESET,
  people: [person('Dan', true), person('Wei Ling'), person('Arjun')],
  items: [
    { name: 'Laksa', amountCents: 1000, personIndexes: [1] },
    { name: 'Satay', amountCents: 2000, personIndexes: [0, 1, 2] },
    { name: 'Chilli crab', amountCents: 4800, personIndexes: [0, 1, 2] },
    { name: 'Char kway teow', amountCents: 850, personIndexes: [2] },
    { name: 'Iced barley (2)', amountCents: 560, personIndexes: [0, 2] },
  ],
}
const issues = (input: unknown) => {
  const r = QuickSplitInput.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('QuickSplitInput', () => {
  it('accepts the README example, trimming text and reading an empty place as none', () => {
    const r = QuickSplitInput.safeParse({ ...valid, title: '  Team lunch ', place: '  ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.title).toBe('Team lunch')
      expect(r.data.place).toBeNull()
    }
  })

  it('takes optional person ids and looks', () => {
    const people = [{ id: 'p1', name: 'Dan', isPayer: true, avatar: { animal: 'fox', color: 'peach' } }, person('Wei Ling'), person('Arjun')]
    expect(QuickSplitInput.safeParse({ ...valid, people }).success).toBe(true)
  })

  it.each([
    ['an empty title', { title: ' ' }],
    ['a title over 50 characters', { title: 'x'.repeat(51) }],
    ['a place over 60 characters', { place: 'x'.repeat(61) }],
    ['a date that is not a real day', { spentOn: '2026-02-30' }],
    ['a service charge over 30%', { serviceChargeBps: 3001 }],
    ['a negative GST', { gstBps: -1 }],
  ])('rejects %s', (_, over) => {
    expect(QuickSplitInput.safeParse({ ...valid, ...over }).success).toBe(false)
  })

  it(`takes 2 to ${QUICK_SPLIT_MAX_PEOPLE} people`, () => {
    const many = (n: number) => [person('P0', true), ...Array.from({ length: n - 1 }, (_, i) => person(`P${i + 1}`))]
    const shareAll = (n: number) => [{ name: 'Feast', amountCents: 100_000, personIndexes: Array.from({ length: n }, (_, i) => i) }]
    expect(QuickSplitInput.safeParse({ ...valid, people: many(2), items: shareAll(2) }).success).toBe(true)
    expect(QuickSplitInput.safeParse({ ...valid, people: many(20), items: shareAll(20) }).success).toBe(true)
    expect(QuickSplitInput.safeParse({ ...valid, people: many(1), items: shareAll(1) }).success).toBe(false)
    expect(QuickSplitInput.safeParse({ ...valid, people: many(21), items: shareAll(21) }).success).toBe(false)
  })

  it(`takes 1 to ${QUICK_SPLIT_MAX_ITEMS} items`, () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Dish ${i}`, amountCents: 100, personIndexes: [0, 1, 2] }))
    expect(QuickSplitInput.safeParse({ ...valid, items: items(1) }).success).toBe(true)
    expect(QuickSplitInput.safeParse({ ...valid, items: items(50) }).success).toBe(true)
    expect(QuickSplitInput.safeParse({ ...valid, items: [] }).success).toBe(false)
    expect(QuickSplitInput.safeParse({ ...valid, items: items(51) }).success).toBe(false)
  })

  it.each([
    ['an item name over 60 characters', { name: 'x'.repeat(61) }],
    ['an empty item name', { name: '' }],
    ['a 0 amount', { amountCents: 0 }],
    ['an amount over $1,000,000', { amountCents: 100_000_001 }],
    ['an amount that is not whole cents', { amountCents: 10.5 }],
  ])('rejects an item with %s', (_, over) => {
    expect(QuickSplitInput.safeParse({ ...valid, items: [{ ...valid.items[0], personIndexes: [0, 1, 2], ...over }] }).success).toBe(false)
  })

  it('needs at least one person on every item, each of them in the split and named once', () => {
    expect(issues({ ...valid, items: [...valid.items, { name: 'Chendol', amountCents: 300, personIndexes: [] }] })).not.toEqual([])
    expect(issues({ ...valid, items: [...valid.items, { name: 'Chendol', amountCents: 300, personIndexes: [3] }] })).toContain('Pick who had each dish.')
    expect(issues({ ...valid, items: [...valid.items, { name: 'Chendol', amountCents: 300, personIndexes: [1, 1] }] })).toContain('Pick who had each dish.')
  })

  it('needs exactly one payer', () => {
    expect(issues({ ...valid, people: [person('Dan'), person('Wei Ling'), person('Arjun')] })).toContain('Pick who paid.')
    expect(issues({ ...valid, people: [person('Dan', true), person('Wei Ling', true), person('Arjun')] })).toContain('Pick who paid.')
  })

  it('needs names that differ, ignoring case', () => {
    expect(issues({ ...valid, people: [person('Dan', true), person('Wei Ling'), person(' dan ')] })).toContain('Everyone needs a different name.')
  })

  it('refuses a name with emoji, or longer than 24 characters', () => {
    expect(QuickSplitInput.safeParse({ ...valid, people: [person('Dan', true), person('Wei Ling 🍜'), person('Arjun')] }).success).toBe(false)
    expect(QuickSplitInput.safeParse({ ...valid, people: [person('Dan', true), person('x'.repeat(25)), person('Arjun')] }).success).toBe(false)
  })

  it('refuses a person id sent twice', () => {
    const people = [{ ...person('Dan', true), id: 'p1' }, { ...person('Wei Ling'), id: 'p1' }, person('Arjun')]
    expect(QuickSplitInput.safeParse({ ...valid, people }).success).toBe(false)
  })

  it('needs everyone but the payer to have had something', () => {
    expect(issues({ ...valid, people: [...valid.people, person('Priya')] })).toContain('Everyone but the payer needs at least one dish.')
  })

  it('refuses a dish too small to give everyone who shared it a cent, so no one has a 0¢ dish', () => {
    // Everyone has other dishes, so no total is 0, but the 1¢ mint would be "Mint ÷2 $0.00" for one of them.
    const mint = { name: 'Mint', amountCents: 1, personIndexes: [1, 2] }
    expect(issues({ ...valid, items: [...valid.items, mint] })).toContain("That's too small to split between that many people.")
    expect(QuickSplitInput.safeParse({ ...valid, items: [...valid.items, { ...mint, amountCents: 2 }] }).success).toBe(true)
  })

  it('refuses a bill too small to give everyone a cent, or over $1,000,000 in all', () => {
    expect(issues({ ...valid, items: [{ name: 'Mint', amountCents: 2, personIndexes: [0, 1, 2] }] })).toContain(
      "That's too small to split between that many people.",
    )
    expect(issues({ ...valid, items: [{ name: 'Gold', amountCents: 100_000_000, personIndexes: [0, 1, 2] }] })).toContain(
      'Keep the bill to $1,000,000.00 or less.',
    )
  })
})
