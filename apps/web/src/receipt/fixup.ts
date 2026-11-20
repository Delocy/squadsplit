import { itemizedTotal, RECEIPT_TOTAL_TOLERANCE_CENTS } from '@squadsplit/shared'

// The fix-up for a bill whose items don't add up to its total (a receipt that lists a line the scan missed, say):
// one line saying how far off it is, and an "Other" item, shared by everyone, that makes up the shortfall. Used by
// the group expense form and Quick split alike. All money is integer cents.

/** How far the items' total may sit from the bill's total: a receipt rounds each of its charges on its own. */
export const TOTAL_TOLERANCE_CENTS = RECEIPT_TOTAL_TOLERANCE_CENTS

export interface Charges {
  serviceChargeBps: number
  gstBps: number
}

/** The Other line: its price before the charges, and what it adds once they're on. */
export interface OtherLine {
  priceCents: number
  withChargesCents: number
}

export interface TotalCheck {
  /** The items with the charges. */
  itemsTotal: number
  /** The bill's total minus the items' (positive: the items are short). */
  diff: number
  /** The one line that says so. */
  message: string
  /** What to add when the items are short; null when they come to more. */
  other: OtherLine | null
}

/** The items plus the charges, from the items' subtotal (the charges apply to the subtotal as a whole). */
const withCharges = (subtotal: number, charges: Charges) =>
  itemizedTotal({ items: [{ name: '', amountCents: subtotal, userIds: [] }], ...charges })

/**
 * The pre-charge price of an Other item whose items-plus-charges total lands closest to `target`, or null when the
 * items aren't short of it.
 */
export function otherLine(subtotal: number, charges: Charges, target: number): OtherLine | null {
  const before = withCharges(subtotal, charges)
  const gap = target - before
  if (gap < 1) return null
  const totalWith = (price: number) => withCharges(subtotal + price, charges)
  const guess = Math.round(gap / ((1 + charges.serviceChargeBps / 10_000) * (1 + charges.gstBps / 10_000)))
  let best = Math.max(1, guess)
  for (let price = Math.max(1, guess - 5); price <= guess + 5; price++) {
    if (Math.abs(totalWith(price) - target) < Math.abs(totalWith(best) - target)) best = price
  }
  return { priceCents: best, withChargesCents: totalWith(best) - before }
}

/**
 * Whether the items (`subtotal`, before charges) add up to the bill's `target` total, within TOTAL_TOLERANCE_CENTS:
 * null when they do, otherwise the one line that says how far off they are and the Other line that fixes it.
 */
export function checkTotal(subtotal: number, charges: Charges, target: number, money: (cents: number) => string): TotalCheck | null {
  const itemsTotal = withCharges(subtotal, charges)
  const diff = target - itemsTotal
  if (Math.abs(diff) <= TOTAL_TOLERANCE_CENTS) return null
  const off = diff > 0 ? `${money(diff)} short of` : `${money(-diff)} more than`
  return {
    itemsTotal,
    diff,
    message: `Items + charges come to ${money(itemsTotal)}, ${off} the ${money(target)} total.`,
    other: diff > 0 ? otherLine(subtotal, charges, target) : null,
  }
}

/** "Add Other $1.00 (+ charges = $1.20)": honest that the line is before the charges. Just "Add Other $1.20" without. */
export function fixupLabel(other: OtherLine, money: (cents: number) => string): string {
  return other.withChargesCents === other.priceCents
    ? `Add Other ${money(other.priceCents)}`
    : `Add Other ${money(other.priceCents)} (+ charges = ${money(other.withChargesCents)})`
}
