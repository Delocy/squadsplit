import { describe, expect, it } from 'vitest'
import type { ReceiptScanResult } from '@squadsplit/shared'
import { applyScan, billSoFar, newQuickDraft, ratesOf } from '../src/quick/draft'

const draft = () => newQuickDraft('Dan', '2026-11-19')

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
