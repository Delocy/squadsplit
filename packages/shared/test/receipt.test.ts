import { describe, expect, it } from 'vitest'
import {
  MAX_RECEIPT_IMAGE_BYTES,
  ReceiptScanResult,
  receiptChargesIncluded,
  ScanReceiptInput,
  normalizeReceiptScan,
  receiptItemsTotal,
  receiptTotalMatches,
} from '../src/index'

describe('ScanReceiptInput', () => {
  it('takes base64 image data with a JPEG, PNG or WebP type', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(ScanReceiptInput.safeParse({ imageBase64: '/9j/4AAQ', mimeType }).success).toBe(true)
    }
  })

  it('refuses other types, empty data and data that would decode to more than 1.5 MB', () => {
    expect(ScanReceiptInput.safeParse({ imageBase64: '/9j/4AAQ', mimeType: 'image/gif' }).success).toBe(false)
    expect(ScanReceiptInput.safeParse({ imageBase64: '', mimeType: 'image/jpeg' }).success).toBe(false)
    const tooLong = 'A'.repeat(Math.ceil(MAX_RECEIPT_IMAGE_BYTES / 3) * 4 + 4)
    expect(ScanReceiptInput.safeParse({ imageBase64: tooLong, mimeType: 'image/jpeg' }).success).toBe(false)
    expect(MAX_RECEIPT_IMAGE_BYTES).toBe(1.5 * 1024 * 1024)
  })
})

describe('normalizeReceiptScan', () => {
  it('keeps a well-formed answer as it is', () => {
    const raw = {
      items: [
        { name: 'Laksa', amountCents: 1000 },
        { name: 'Teh Tarik x2', amountCents: 440 },
      ],
      serviceChargeBps: 1000,
      gstBps: 900,
      totalCents: 1726,
    }
    expect(normalizeReceiptScan(raw)).toEqual(raw)
  })

  it('trims and shortens names to 60 characters, and drops items without a usable name or amount', () => {
    const result = normalizeReceiptScan({
      items: [
        { name: '  Chicken   Rice \n', amountCents: 550 },
        { name: 'x'.repeat(80), amountCents: 100 },
        { name: '   ', amountCents: 100 },
        { name: 'Free water', amountCents: 0 },
        { name: 'Refund', amountCents: -300 },
        { name: 'Huge', amountCents: 100_000_001 },
        { name: 'Not a number', amountCents: 'lots' },
        { amountCents: 100 },
        'Kopi 1.20',
      ],
      serviceChargeBps: null,
      gstBps: null,
      totalCents: null,
    })
    expect(result?.items).toEqual([
      { name: 'Chicken Rice', amountCents: 550 },
      { name: 'x'.repeat(60), amountCents: 100 },
    ])
  })

  it('rounds fractional cents and reads numeric strings', () => {
    const result = normalizeReceiptScan({ items: [{ name: 'Kopi', amountCents: '120' }, { name: 'Toast', amountCents: 249.6 }] })
    expect(result?.items).toEqual([
      { name: 'Kopi', amountCents: 120 },
      { name: 'Toast', amountCents: 250 },
    ])
  })

  it('keeps at most 50 items', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ name: `Item ${i + 1}`, amountCents: 100 }))
    expect(normalizeReceiptScan({ items })?.items).toHaveLength(50)
  })

  it('treats missing or out-of-range charges and totals as unknown', () => {
    const items = [{ name: 'Laksa', amountCents: 1000 }]
    expect(normalizeReceiptScan({ items })).toEqual({ items, serviceChargeBps: null, gstBps: null, totalCents: null })
    expect(normalizeReceiptScan({ items, serviceChargeBps: 3001, gstBps: -1, totalCents: 0 })).toEqual({
      items,
      serviceChargeBps: null,
      gstBps: null,
      totalCents: null,
    })
    expect(normalizeReceiptScan({ items, serviceChargeBps: 0, gstBps: 3000, totalCents: 1300 })).toEqual({
      items,
      serviceChargeBps: 0,
      gstBps: 3000,
      totalCents: 1300,
    })
  })

  it('returns null when there is nothing to use', () => {
    expect(normalizeReceiptScan(null)).toBeNull()
    expect(normalizeReceiptScan('Laksa 10.00')).toBeNull()
    expect(normalizeReceiptScan({})).toBeNull()
    expect(normalizeReceiptScan({ items: [] })).toBeNull()
    expect(normalizeReceiptScan({ items: [{ name: 'Water', amountCents: 0 }] })).toBeNull()
  })

  it('always returns something ReceiptScanResult accepts', () => {
    const result = normalizeReceiptScan({ items: [{ name: ' ‮abc ', amountCents: 1 }], serviceChargeBps: 999.6 })
    expect(ReceiptScanResult.parse(result)).toEqual({
      items: [{ name: 'abc', amountCents: 1 }],
      serviceChargeBps: 1000,
      gstBps: null,
      totalCents: null,
    })
  })
})

describe('receipt total check', () => {
  const base = { items: [{ name: 'Laksa', amountCents: 6000 }, { name: 'Satay', amountCents: 1800 }] }

  it('adds up the items with the receipt’s service charge and GST, like the itemized split does', () => {
    expect(receiptItemsTotal({ ...base, serviceChargeBps: 1000, gstBps: 900, totalCents: null })).toBe(9352)
    expect(receiptItemsTotal({ ...base, serviceChargeBps: null, gstBps: 900, totalCents: null })).toBe(8502)
    expect(receiptItemsTotal({ ...base, serviceChargeBps: null, gstBps: null, totalCents: null })).toBe(7800)
  })

  it('matches the printed total, allowing the cent each charge line can round by', () => {
    const sg = { ...base, serviceChargeBps: 1000, gstBps: 900 }
    expect(receiptTotalMatches({ ...sg, totalCents: 9352 })).toBe(true)
    expect(receiptTotalMatches({ ...sg, totalCents: 9354 })).toBe(true)
    expect(receiptTotalMatches({ ...sg, totalCents: 9350 })).toBe(true)
    expect(receiptTotalMatches({ ...sg, totalCents: 9355 })).toBe(false)
    expect(receiptTotalMatches({ ...sg, totalCents: 8000 })).toBe(false)
  })

  it('is null when the receipt shows no total', () => {
    expect(receiptTotalMatches({ ...base, serviceChargeBps: 1000, gstBps: 900, totalCents: null })).toBeNull()
  })
})

describe('receiptChargesIncluded', () => {
  // A café receipt whose prices already include GST: 6.50 + 9.00 + 9.00 + 9.00 = 33.50, and the model still says 9%.
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

  it('is true when the plain items make the total and the items with charges do not (the café example)', () => {
    expect(receiptChargesIncluded(cafe)).toBe(true)
    expect(receiptChargesIncluded({ ...cafe, totalCents: 3352 })).toBe(true)
  })

  it('is false when the charges are added on top, with no charges, or with no total', () => {
    expect(receiptChargesIncluded({ ...cafe, totalCents: 3652 })).toBe(false)
    expect(receiptChargesIncluded({ ...cafe, gstBps: null })).toBe(false)
    expect(receiptChargesIncluded({ ...cafe, gstBps: 0, serviceChargeBps: 0 })).toBe(false)
    expect(receiptChargesIncluded({ ...cafe, totalCents: null })).toBe(false)
    expect(receiptChargesIncluded({ ...cafe, totalCents: 3400 })).toBe(false)
  })
})
