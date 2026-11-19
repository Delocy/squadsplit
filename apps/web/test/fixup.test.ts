import { formatMoney, itemizedTotal, RECEIPT_TOTAL_TOLERANCE_CENTS, SG_PRESET } from '@squadsplit/shared'
import { describe, expect, it } from 'vitest'
import { checkTotal, fixupLabel, TOTAL_TOLERANCE_CENTS } from '../src/receipt/fixup'

const money = (cents: number) => formatMoney(cents, 'SGD')
const NONE = { serviceChargeBps: 0, gstBps: 0 }
const totalOf = (subtotal: number, charges = SG_PRESET) => itemizedTotal({ items: [{ name: '', amountCents: subtotal, userIds: [] }], ...charges })

describe('the receipt fix-up', () => {
  it('allows the same 2 cents a receipt can round its charges by', () => {
    expect(TOTAL_TOLERANCE_CENTS).toBe(RECEIPT_TOTAL_TOLERANCE_CENTS)
    expect(TOTAL_TOLERANCE_CENTS).toBe(2)
    const items = totalOf(7800)
    expect(checkTotal(7800, SG_PRESET, items + 2, money)).toBeNull()
    expect(checkTotal(7800, SG_PRESET, items - 2, money)).toBeNull()
    expect(checkTotal(7800, SG_PRESET, items + 3, money)).not.toBeNull()
  })

  it('says in one line how far short the items are, and offers an Other that lands on the total', () => {
    // The hawker receipt: $67.26 with the SG charges, $1.20 short of $68.46.
    const subtotal = 5610
    expect(totalOf(subtotal)).toBe(6726)
    const check = checkTotal(subtotal, SG_PRESET, 6846, money)!
    expect(check.message).toBe('Items + charges come to $67.26, $1.20 short of the $68.46 total.')
    expect(check.diff).toBe(120)
    expect(check.other).toEqual({ priceCents: 100, withChargesCents: 120 })
    expect(totalOf(subtotal + check.other!.priceCents)).toBe(6846)
  })

  it('is honest that the Other line is before charges', () => {
    expect(fixupLabel({ priceCents: 100, withChargesCents: 120 }, money)).toBe('Add Other $1.00 (+ charges = $1.20)')
    // With no charges on, the line is the gap itself.
    const check = checkTotal(7800, NONE, 10_000, money)!
    expect(check.other).toEqual({ priceCents: 2200, withChargesCents: 2200 })
    expect(fixupLabel(check.other!, money)).toBe('Add Other $22.00')
  })

  it('offers no Other when the items come to more than the total', () => {
    const check = checkTotal(7800, SG_PRESET, 9000, money)!
    expect(check.message).toBe('Items + charges come to $93.52, $3.52 more than the $90.00 total.')
    expect(check.other).toBeNull()
  })
})
