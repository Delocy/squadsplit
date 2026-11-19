import { itemizedTotal, SG_PRESET, type ReceiptScanResult } from '@squadsplit/shared'
import { describe, expect, it } from 'vitest'
import { addOtherItem, applyScan, draftFromExpense, newDraft, parseAmount, summarize, type ExpenseDraft } from '../src/expenseDraft'
import { BOB, expense } from './group-fixtures'

const ME = 'user_me'
const IDS = [ME, BOB]

/** A By item draft: Laksa 60.00 and Satay 18.00 (93.52 with the SG charges), both assigned. */
function itemized(over: Partial<ExpenseDraft> = {}): ExpenseDraft {
  const d = newDraft(ME, IDS, '2026-11-19')
  const [row] = d.items
  return {
    ...d,
    description: 'Dinner',
    mode: 'itemized',
    items: [
      { ...row!, name: 'Laksa', price: '60.00', userIds: [ME] },
      { ...row!, key: row!.key + 1000, name: 'Satay', price: '18.00', userIds: [BOB] },
    ],
    ...over,
  }
}

describe('By item total check', () => {
  it('blocks saving when a pinned total is more than the items cover', () => {
    const s = summarize(itemized({ amount: '100.00' }), IDS, 'SGD')
    expect(s.input).toBeNull()
    expect(s.problem).toBe('Items + charges come to $93.52, $6.48 not on any item.')
    expect(s.check).toMatchObject({ itemsTotal: 9352, diff: 648 })
  })

  it('blocks saving when the items come to more than the pinned total', () => {
    const s = summarize(itemized({ amount: '90.00' }), IDS, 'SGD')
    expect(s.input).toBeNull()
    expect(s.problem).toBe('Items + charges come to $93.52, $3.52 more than the total.')
    expect(s.check!.diff).toBe(-352)
  })

  it('allows a pinned total within 2 cents, and saves the items total', () => {
    for (const amount of ['93.50', '93.54']) {
      const s = summarize(itemized({ amount }), IDS, 'SGD')
      expect(s.check).toBeNull()
      expect(s.problem).toBeNull()
      expect(s.input!.amountCents).toBe(9352)
    }
    expect(summarize(itemized({ amount: '93.55' }), IDS, 'SGD').check).not.toBeNull()
  })

  it('does no check when the total is blank', () => {
    const s = summarize(itemized({ amount: '' }), IDS, 'SGD')
    expect(s.check).toBeNull()
    expect(s.problem).toBeNull()
    expect(s.amountCents).toBe(9352)
  })

  it('asks for a sensible total when the typed one is not an amount', () => {
    const s = summarize(itemized({ amount: 'abc' }), IDS, 'SGD')
    expect(s.input).toBeNull()
    expect(s.problem).toBe('Check the total: use an amount like 93.52.')
  })
})

describe('addOtherItem', () => {
  it('without charges, adds exactly the difference', () => {
    const d = addOtherItem(itemized({ amount: '100.00', restaurantBill: false }), IDS)
    const other = d.items.at(-1)!
    expect(other).toMatchObject({ name: 'Other', price: '22.00', userIds: IDS })
    expect(summarize(d, IDS, 'SGD').check).toBeNull()
  })

  it('with SG charges, lands within 2 cents of the target for any gap', () => {
    for (const target of ['100.00', '93.60', '94.57', '250.01', '1000.00']) {
      const d = addOtherItem(itemized({ amount: target, charges: { ...SG_PRESET } }), IDS)
      const items = d.items.map((it) => ({ name: it.name, amountCents: parseAmount(it.price)!, userIds: it.userIds }))
      expect(Math.abs(itemizedTotal({ items, ...SG_PRESET }) - parseAmount(target)!)).toBeLessThanOrEqual(2)
      expect(summarize(d, IDS, 'SGD').check).toBeNull()
    }
  })

  it('replaces untouched blank rows and does nothing when items are not short', () => {
    const base = itemized({ amount: '100.00' })
    const withBlank = { ...base, items: [...base.items, { key: 999, name: '', price: '', userIds: [] }] }
    expect(addOtherItem(withBlank, IDS).items.map((i) => i.name)).toEqual(['Laksa', 'Satay', 'Other'])
    const over = itemized({ amount: '90.00' })
    expect(addOtherItem(over, IDS)).toBe(over)
  })
})

describe('draft from a saved or scanned expense', () => {
  it('leaves the total blank for an itemized expense, so it follows the items', () => {
    const d = draftFromExpense(
      expense({ splitType: 'itemized', amountCents: 3597, serviceChargeBps: 1000, gstBps: 900, items: [{ name: 'Laksa', amountCents: 3000, userIds: [ME] }] }),
      IDS,
    )
    expect(d.amount).toBe('')
  })

  it('keeps the amount for an equal expense', () => {
    expect(draftFromExpense(expense({ amountCents: 1000 }), IDS).amount).toBe('10.00')
  })

  it('applyScan still pins the receipt total', () => {
    const scan: ReceiptScanResult = { items: [{ name: 'Laksa', amountCents: 6000 }], serviceChargeBps: 1000, gstBps: 900, totalCents: 9352 }
    expect(applyScan(newDraft(ME, IDS, '2026-11-19'), scan).amount).toBe('93.52')
  })
})
