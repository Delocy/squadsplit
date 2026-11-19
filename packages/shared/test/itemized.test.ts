import { describe, expect, it } from 'vitest'
import { SG_PRESET, itemizedTotal, splitItemized, SplitError, type ItemizedBill } from '../src/index'

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

describe('itemizedTotal', () => {
  it('applies service charge then GST (1000 -> 1199)', () => {
    const bill: ItemizedBill = { items: [{ name: 'Laksa', amountCents: 1000, userIds: ['a'] }], ...SG_PRESET }
    expect(itemizedTotal(bill)).toBe(1199)
  })

  it('is the plain subtotal with no charges', () => {
    const bill: ItemizedBill = {
      items: [{ name: 'X', amountCents: 777, userIds: ['a'] }],
      serviceChargeBps: 0,
      gstBps: 0,
    }
    expect(itemizedTotal(bill)).toBe(777)
  })

  it('rounds half up', () => {
    // 5 * 1.1 = 5.5 -> 6 ; 1 * 1.5 = 1.5 -> 2 ; 3 * 1.1 = 3.3 -> 3
    const mk = (amountCents: number, serviceChargeBps: number): ItemizedBill => ({
      items: [{ name: 'X', amountCents, userIds: ['a'] }],
      serviceChargeBps,
      gstBps: 0,
    })
    expect(itemizedTotal(mk(5, 1000))).toBe(6)
    expect(itemizedTotal(mk(1, 3000))).toBe(1)
    expect(itemizedTotal(mk(5, 3000))).toBe(7)
  })

  it('stays exact for the maximum amount', () => {
    const bill: ItemizedBill = {
      items: Array.from({ length: 50 }, (_, i) => ({ name: `i${i}`, amountCents: 100_000_000, userIds: ['a'] })),
      serviceChargeBps: 3000,
      gstBps: 3000,
    }
    expect(itemizedTotal(bill)).toBe(8_450_000_000)
  })
})

describe('splitItemized', () => {
  it('allocates proportionally with the SG preset', () => {
    const bill: ItemizedBill = {
      items: [
        { name: 'A', amountCents: 1000, userIds: ['a'] },
        { name: 'B', amountCents: 2000, userIds: ['b'] },
      ],
      ...SG_PRESET,
    }
    expect(itemizedTotal(bill)).toBe(3597)
    const shares = splitItemized(bill, 'a')
    expect(shares).toEqual({ a: 1199, b: 2398 })
    expect(sum(shares)).toBe(3597)
  })

  it('splits shared items between their users', () => {
    const bill: ItemizedBill = {
      items: [
        { name: 'Pizza', amountCents: 1000, userIds: ['a', 'b'] },
        { name: 'Beer', amountCents: 500, userIds: ['a'] },
      ],
      serviceChargeBps: 0,
      gstBps: 0,
    }
    expect(splitItemized(bill, 'a')).toEqual({ a: 1000, b: 500 })
  })

  it('gives an odd shared-item cent to the payer when they are on the item', () => {
    const bill: ItemizedBill = {
      items: [{ name: 'Fries', amountCents: 101, userIds: ['a', 'b'] }],
      serviceChargeBps: 0,
      gstBps: 0,
    }
    expect(splitItemized(bill, 'b')).toEqual({ a: 50, b: 51 })
  })

  it('breaks largest-remainder ties toward the lower user id', () => {
    const bill: ItemizedBill = {
      items: [
        { name: 'X', amountCents: 1, userIds: ['b'] },
        { name: 'Y', amountCents: 1, userIds: ['a'] },
      ],
      serviceChargeBps: 3000,
      gstBps: 0,
    }
    expect(itemizedTotal(bill)).toBe(3)
    expect(splitItemized(bill, 'z')).toEqual({ a: 2, b: 1 })
  })

  it('distributes leftover cents by largest fractional remainder', () => {
    const bill: ItemizedBill = {
      items: [
        { name: 'X', amountCents: 100, userIds: ['a'] },
        { name: 'Y', amountCents: 200, userIds: ['b'] },
        { name: 'Z', amountCents: 300, userIds: ['c'] },
      ],
      serviceChargeBps: 0,
      gstBps: 900,
    }
    const total = itemizedTotal(bill)
    const shares = splitItemized(bill, 'a')
    expect(sum(shares)).toBe(total)
    expect(shares).toEqual({ a: 109, b: 218, c: 327 })
  })

  it('tolerates a tiny item as long as nobody ends at 0', () => {
    const bill: ItemizedBill = {
      items: [
        { name: 'Sweet', amountCents: 1, userIds: ['a', 'b', 'c'] },
        { name: 'Rice', amountCents: 300, userIds: ['a', 'b', 'c'] },
      ],
      serviceChargeBps: 0,
      gstBps: 0,
    }
    const shares = splitItemized(bill, 'a')
    expect(sum(shares)).toBe(301)
    expect(Math.min(...Object.values<number>(shares))).toBeGreaterThan(0)
  })

  it('throws SplitError when a 1 cent item is split three ways alone', () => {
    const bill: ItemizedBill = {
      items: [{ name: 'Sweet', amountCents: 1, userIds: ['a', 'b', 'c'] }],
      serviceChargeBps: 0,
      gstBps: 0,
    }
    expect(() => splitItemized(bill, 'a')).toThrow(SplitError)
  })
})
