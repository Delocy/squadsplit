import { describe, expect, it } from 'vitest'
import { receiptTotalMatches, type ReceiptScanResult } from '@squadsplit/shared'
import { UNREADABLE_BANNER, scanBanner } from '../src/receipt/banner'
import type { ReceiptScan } from '../src/receipt/scanReceipt'

const EMOJI = /\p{Extended_Pictographic}/u

const result: ReceiptScanResult = {
  items: [
    { name: 'Laksa', amountCents: 6000 },
    { name: 'Satay x10', amountCents: 1800 },
  ],
  serviceChargeBps: 1000,
  gstBps: 900,
  totalCents: 9352,
}
const scanOf = (r: ReceiptScanResult, source: ReceiptScan['source'] = 'ai'): ReceiptScan => ({
  ...r,
  totalMatches: receiptTotalMatches(r),
  source,
})

describe('scanBanner', () => {
  it('confirms a matching total from the AI scan', () => {
    expect(scanBanner(scanOf(result), 'SGD')).toBe('Read your receipt — total $93.52 matches. Tap who had what.')
  })

  it('asks for a check when the items do not add up to the printed total', () => {
    expect(scanBanner(scanOf({ ...result, totalCents: 10_000 }), 'SGD')).toBe(
      'Receipt says $100.00, items add up to $93.52 — please check the items.',
    )
  })

  it('formats money in the group currency', () => {
    expect(scanBanner(scanOf(result), 'EUR')).toBe('Read your receipt — total €93.52 matches. Tap who had what.')
  })

  it('just says to assign people when the receipt shows no total', () => {
    expect(scanBanner(scanOf({ ...result, totalCents: null }), 'SGD')).toBe('Read your receipt — tap who had what.')
  })

  it('says to double-check a receipt read on the phone, whatever the total', () => {
    expect(scanBanner(scanOf(result, 'phone'), 'SGD')).toBe('Read on your phone — double-check the items and prices.')
    expect(scanBanner(scanOf({ ...result, totalCents: 1 }, 'phone'), 'SGD')).toBe('Read on your phone — double-check the items and prices.')
  })

  it('mentions when the receipt’s charges are not the SG 10% + 9% the toggle adds', () => {
    const gstOnly = { ...result, serviceChargeBps: null, totalCents: 8502 }
    expect(scanBanner(scanOf(gstOnly), 'SGD')).toBe(
      'Read your receipt — total $85.02 matches. Tap who had what. ' +
        "Its charges aren't the usual 10% service charge and 9% GST, so the restaurant bill toggle is off.",
    )
    expect(scanBanner(scanOf({ ...result, serviceChargeBps: null, gstBps: null, totalCents: null }), 'SGD')).toBe(
      'Read your receipt — tap who had what.',
    )
  })

  it('never shows emoji', () => {
    for (const text of [
      scanBanner(scanOf(result), 'SGD'),
      scanBanner(scanOf({ ...result, totalCents: 1 }), 'SGD'),
      scanBanner(scanOf(result, 'phone'), 'SGD'),
      UNREADABLE_BANNER,
    ]) {
      expect(text).not.toMatch(EMOJI)
    }
    expect(UNREADABLE_BANNER).toBe("Couldn't read this receipt — add the items by hand.")
  })
})
