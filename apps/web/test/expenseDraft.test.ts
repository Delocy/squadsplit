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
    expect(s.problem).toBe('Items + charges come to $93.52, $6.48 short of the $100.00 total.')
    expect(s.check).toMatchObject({ itemsTotal: 9352, diff: 648 })
    // The fix-up's Other line is before the charges, and says what it comes to with them.
    expect(s.check!.other).toEqual({ priceCents: 540, withChargesCents: 648 })
  })

  it('blocks saving when the items come to more than the pinned total', () => {
    const s = summarize(itemized({ amount: '90.00' }), IDS, 'SGD')
    expect(s.input).toBeNull()
    expect(s.problem).toBe('Items + charges come to $93.52, $3.52 more than the $90.00 total.')
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

describe('charges on and off separately', () => {
  const total = (over: Partial<ExpenseDraft>) =>
    summarize(itemized({ items: [{ key: 1, name: 'Laksa', price: '10.00', userIds: [ME] }], ...over }), IDS, 'SGD').amountCents

  it('adds GST alone, service charge alone, or both (service first, then GST on top)', () => {
    expect(total({ serviceOn: false })).toBe(1090)
    expect(total({ gstOn: false })).toBe(1100)
    expect(total({})).toBe(1199)
    expect(total({ serviceOn: false, gstOn: false })).toBe(1000)
  })

  it('sends 0 for an off charge', () => {
    const s = summarize(itemized({ serviceOn: false }), IDS, 'SGD')
    expect(s.input!.split).toMatchObject({ type: 'itemized', serviceChargeBps: 0, gstBps: 900 })
  })

  it('a new draft has both on at the SG rates', () => {
    expect(newDraft(ME, IDS, '2026-11-19')).toMatchObject({ serviceOn: true, gstOn: true, charges: SG_PRESET })
  })

  it('a scan without a service charge leaves it off at the SG rate, so turning it on gives 10%', () => {
    const scan: ReceiptScanResult = { items: [{ name: 'Laksa', amountCents: 1000 }], serviceChargeBps: null, gstBps: 900, totalCents: 1090 }
    const d = applyScan(newDraft(ME, IDS, '2026-11-19'), scan)
    expect(d).toMatchObject({ serviceOn: false, gstOn: true, charges: { serviceChargeBps: 1000, gstBps: 900 } })
    const on = { ...d, serviceOn: true }
    expect(summarize({ ...on, description: 'x', items: d.items.map((i) => ({ ...i, userIds: [ME] })) }, IDS, 'SGD').amountCents).toBe(1199)
  })

  it('a scan keeps the rate of a charge the receipt has', () => {
    const scan: ReceiptScanResult = { items: [{ name: 'Laksa', amountCents: 1000 }], serviceChargeBps: 1200, gstBps: null, totalCents: null }
    expect(applyScan(newDraft(ME, IDS, '2026-11-19'), scan)).toMatchObject({ serviceOn: true, gstOn: false, charges: { serviceChargeBps: 1200, gstBps: 900 } })
  })

  it('a saved itemized expense with service 0 and GST 900 has service off and GST on', () => {
    const d = draftFromExpense(expense({ splitType: 'itemized', amountCents: 1090, serviceChargeBps: 0, gstBps: 900, items: [{ name: 'Laksa', amountCents: 1000, userIds: [ME] }] }), IDS)
    expect(d).toMatchObject({ serviceOn: false, gstOn: true, charges: { serviceChargeBps: 1000, gstBps: 900 } })
  })

  it('a saved itemized expense without charges has both off, and an equal one starts with both on', () => {
    const saved = draftFromExpense(expense({ splitType: 'itemized', amountCents: 1000, serviceChargeBps: 0, gstBps: 0, items: [{ name: 'Laksa', amountCents: 1000, userIds: [ME] }] }), IDS)
    expect(saved).toMatchObject({ serviceOn: false, gstOn: false })
    expect(draftFromExpense(expense({ amountCents: 1000 }), IDS)).toMatchObject({ serviceOn: true, gstOn: true, charges: SG_PRESET })
  })

  it('the Other fix-up lands on the target with GST only', () => {
    for (const target of ['100.00', '93.60', '250.01']) {
      const d = addOtherItem(itemized({ amount: target, serviceOn: false }), IDS)
      const items = d.items.map((it) => ({ name: it.name, amountCents: parseAmount(it.price)!, userIds: it.userIds }))
      expect(Math.abs(itemizedTotal({ items, serviceChargeBps: 0, gstBps: 900 }) - parseAmount(target)!)).toBeLessThanOrEqual(2)
      expect(summarize(d, IDS, 'SGD').check).toBeNull()
    }
  })
})

describe('addOtherItem', () => {
  it('without charges, adds exactly the difference', () => {
    const d = addOtherItem(itemized({ amount: '100.00', serviceOn: false, gstOn: false }), IDS)
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

  it('puts an Other too small to split between everyone on the payer alone', () => {
    const six = [ME, BOB, 'c', 'd', 'e', 'f']
    const d = addOtherItem(itemized({ amount: '78.03', serviceOn: false, gstOn: false }), six)
    expect(d.items.at(-1)).toMatchObject({ name: 'Other', price: '0.03', userIds: [ME] })
    expect(summarize({ ...d, items: d.items.map((it) => (it.userIds.length ? it : { ...it, userIds: [ME] })) }, six, 'SGD').tooSmall).toBe(false)
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

  it('applyScan switches both charges off when the receipt prices already include them, keeping its rates', () => {
    const scan: ReceiptScanResult = {
      items: [{ name: 'Gratin', amountCents: 650 }, { name: 'Set', amountCents: 900 }, { name: 'Set', amountCents: 900 }, { name: 'Set', amountCents: 900 }],
      serviceChargeBps: null,
      gstBps: 900,
      totalCents: 3350,
    }
    const d = applyScan(newDraft(ME, IDS, '2026-11-19'), scan)
    expect(d).toMatchObject({ serviceOn: false, gstOn: false, charges: { serviceChargeBps: 1000, gstBps: 900 } })
    const assigned = { ...d, description: 'Lunch', items: d.items.map((i) => ({ ...i, userIds: [ME] })) }
    const s = summarize(assigned, IDS, 'SGD')
    expect(s.amountCents).toBe(3350)
    expect(s.check).toBeNull()
  })

  it('applyScan still pins the receipt total', () => {
    const scan: ReceiptScanResult = { items: [{ name: 'Laksa', amountCents: 6000 }], serviceChargeBps: 1000, gstBps: 900, totalCents: 9352 }
    expect(applyScan(newDraft(ME, IDS, '2026-11-19'), scan).amount).toBe('93.52')
  })
})
