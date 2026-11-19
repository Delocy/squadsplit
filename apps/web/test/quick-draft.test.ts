import { describe, expect, it } from 'vitest'
import type { ReceiptScanResult } from '@squadsplit/shared'
import { addOtherDish, addPerson, applyScan, billProblem, billSoFar, newQuickDraft, ratesOf, totalCheck, type QuickDraft } from '../src/quick/draft'

const draft = () => newQuickDraft('Dan', '2026-11-19', { animal: 'fox', color: 'peach' })

describe('applyScan', () => {
  it('starts both charges off when the prices already include them (the café example), keeping the rates to turn on by hand', () => {
    const cafe: ReceiptScanResult = {
      items: [
        { name: 'Latte', amountCents: 650 },
        { name: 'Pasta', amountCents: 900 },
        { name: 'Pasta', amountCents: 900 },
        { name: 'Pasta', amountCents: 900 },
      ],
      serviceChargeBps: null,
      gstBps: 900,
      totalCents: 3350,
    }
    const d = applyScan(draft(), cafe)
    expect(d.service).toEqual({ on: false, bps: 1000 })
    expect(d.gst).toEqual({ on: false, bps: 900 })
    expect(ratesOf(d)).toEqual({ serviceChargeBps: 0, gstBps: 0 })
    expect(billSoFar(d)?.totalCents).toBe(3350)
  })

  it("turns on only the receipt's own charges, at its rates, when they are added on top", () => {
    const d = applyScan(draft(), { items: [{ name: 'Laksa', amountCents: 1000 }], serviceChargeBps: null, gstBps: 800, totalCents: 1080 })
    expect(d.service).toEqual({ on: false, bps: 1000 })
    expect(d.gst).toEqual({ on: true, bps: 800 })
    expect(billSoFar(d)?.totalCents).toBe(1080)
  })

  it('stores 0 for a charge that is off: GST only on $10.00 is $10.90, service only is $11.00', () => {
    const tenDollars = { ...draft(), dishes: [{ key: 'd', name: 'Laksa', price: '10', had: [] }] }
    expect(billSoFar({ ...tenDollars, service: { on: false, bps: 1000 } })?.totalCents).toBe(1090)
    expect(billSoFar({ ...tenDollars, gst: { on: false, bps: 900 } })?.totalCents).toBe(1100)
    expect(ratesOf({ ...tenDollars, gst: { on: false, bps: 900 } })).toEqual({ serviceChargeBps: 1000, gstBps: 0 })
  })
})

describe('the receipt total after a scan', () => {
  // The hawker receipt: dishes $56.10, $67.26 with the SG charges, but the receipt says $68.46.
  const hawker: ReceiptScanResult = {
    items: [
      { name: 'Hokkien mee', amountCents: 800 },
      { name: 'Chicken rice', amountCents: 650 },
      { name: 'Cereal prawns', amountCents: 4160 },
    ],
    serviceChargeBps: 1000,
    gstBps: 900,
    totalCents: 6846,
  }
  const scanned = () => ({ ...applyScan(draft(), hawker), title: 'Lunch' })

  it('keeps the receipt total, editable, and never quietly goes on with the lower one', () => {
    const d = scanned()
    expect(d.receiptTotal).toBe('68.46')
    expect(totalCheck(d)!.message).toBe('Items + charges come to $67.26, $1.20 short of the $68.46 total.')
    expect(billProblem(d)).toBe('Items + charges come to $67.26, $1.20 short of the $68.46 total.')
    // Clearing it goes by the dishes; a total within 2 cents is fine.
    expect(billProblem({ ...d, receiptTotal: '' })).toBeNull()
    expect(billProblem({ ...d, receiptTotal: '67.28' })).toBeNull()
    expect(billProblem({ ...d, receiptTotal: 'abc' })).toBe('Check the receipt total: use an amount like 67.26.')
  })

  it('has no total to check when typed by hand', () => {
    expect(draft().receiptTotal).toBeNull()
    expect(totalCheck(draft())).toBeNull()
  })

  it('adds the rest as Other, shared by everyone in the split, including people added after', () => {
    let d = addOtherDish(scanned())
    const other = d.dishes.at(-1)!
    expect(other).toMatchObject({ name: 'Other', price: '1.00', everyone: true, had: [d.people[0]!.key] })
    expect(billSoFar(d)!.totalCents).toBe(6846)
    expect(billProblem(d)).toBeNull()
    d = addPerson(d, 'Mei')
    expect(d.dishes.at(-1)!.had).toEqual(d.people.map((p) => p.key))
    // The others stay as they were.
    expect(d.dishes[0]!.had).toEqual([])
  })
})

describe('an Other too small to split', () => {
  it('goes on the payer alone, and a shared Other stops growing once one more part would be under a cent', () => {
    let d: QuickDraft = { ...draft(), title: 'Kopi', dishes: [{ key: 'd1', name: 'Kopi', price: '5.00', had: [] }], service: { on: false, bps: 1000 }, gst: { on: false, bps: 900 } }
    d = addPerson(addPerson(addPerson(d, 'Mei'), 'Hafiz'), 'Priya')
    const tiny = addOtherDish({ ...d, receiptTotal: '5.03' })
    expect(tiny.dishes.at(-1)).toMatchObject({ name: 'Other', price: '0.03', had: [d.payerKey], everyone: false })

    const shared = addOtherDish({ ...draft(), title: 'Kopi', dishes: [{ key: 'd1', name: 'Kopi', price: '5.00', had: [] }], service: { on: false, bps: 1000 }, gst: { on: false, bps: 900 }, receiptTotal: '5.03' })
    let grown = addPerson(addPerson(shared, 'Mei'), 'Hafiz')
    expect(grown.dishes.at(-1)!.had).toHaveLength(3)
    grown = addPerson(grown, 'Priya')
    expect(grown.dishes.at(-1)).toMatchObject({ had: grown.dishes.at(-1)!.had, everyone: false })
    expect(grown.dishes.at(-1)!.had).toHaveLength(3)
  })
})
