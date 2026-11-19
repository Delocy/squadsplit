import { SplitError, splitEqual, type Cents } from './money'

export interface BillItem { name: string; amountCents: Cents; userIds: string[] }
export interface ItemizedBill { items: BillItem[]; serviceChargeBps: number; gstBps: number }

/** Singapore: 10% service charge, then 9% GST on top. */
export const SG_PRESET = { serviceChargeBps: 1000, gstBps: 900 } as const

const BPS = 10_000n

function subtotalOf(bill: ItemizedBill): bigint {
  return bill.items.reduce((a, it) => a + BigInt(it.amountCents), 0n)
}

/** subtotal x (1 + sc) x (1 + gst), rounded half up, in BigInt. */
export function itemizedTotal(bill: ItemizedBill): Cents {
  const num = subtotalOf(bill) * (BPS + BigInt(bill.serviceChargeBps)) * (BPS + BigInt(bill.gstBps))
  const den = BPS * BPS
  return Number((num * 2n + den) / (den * 2n))
}

/** Equal split of one item. Unlike splitEqual, an item smaller than its head count is allowed (some get 0). */
function splitItem(item: BillItem, payerId: string): Record<string, Cents> {
  if (item.amountCents >= item.userIds.length) return splitEqual(item.amountCents, item.userIds, payerId)
  const shares: Record<string, Cents> = {}
  for (const id of item.userIds) shares[id] = 0
  if (item.userIds.includes(payerId)) {
    shares[payerId] = item.amountCents
  } else {
    const sorted = [...item.userIds].sort()
    for (let i = 0; i < item.amountCents; i++) shares[sorted[i]!] = 1
  }
  return shares
}

/**
 * Each person's share of the total, proportional to their item subtotal, by the
 * largest-remainder method (ties to the lower user id). Sums exactly to itemizedTotal.
 */
export function splitItemized(bill: ItemizedBill, payerId: string): Record<string, Cents> {
  const subs = new Map<string, bigint>()
  for (const item of bill.items) {
    for (const [uid, cents] of Object.entries(splitItem(item, payerId))) {
      subs.set(uid, (subs.get(uid) ?? 0n) + BigInt(cents))
    }
  }
  const subtotal = subtotalOf(bill)
  const total = BigInt(itemizedTotal(bill))

  const rows = [...subs.entries()].map(([id, sub]) => ({
    id,
    floor: (total * sub) / subtotal,
    rem: (total * sub) % subtotal,
  }))
  let leftover = total - rows.reduce((a, r) => a + r.floor, 0n)
  const order = [...rows].sort((x, y) => (x.rem === y.rem ? (x.id < y.id ? -1 : 1) : x.rem > y.rem ? -1 : 1))
  for (const r of order) {
    if (leftover <= 0n) break
    r.floor += 1n
    leftover -= 1n
  }

  const shares: Record<string, Cents> = {}
  for (const r of rows) {
    if (r.floor === 0n) throw new SplitError()
    shares[r.id] = Number(r.floor)
  }
  return shares
}
