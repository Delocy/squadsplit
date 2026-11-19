import {
  defaultAvatar,
  firstFreeAvatar,
  formatMoney,
  QuickSplitInput,
  quickSplitBreakdown,
  receiptChargesIncluded,
  SG_PRESET,
  SplitError,
  type AvatarChoice,
  type QuickSplitBreakdown,
  type QuickSplitDTO,
  type ReceiptScanResult,
} from '@squadsplit/shared'
import { centsToInput, parseAmount } from '../expenseDraft'
import { parseMemberName } from '../memberName'
import { checkTotal, otherLine, type TotalCheck } from '../receipt/fixup'

// A quick split being made or edited, kept in the page's state until it is saved. Amounts are typed as text and
// only ever become integer cents here.

export interface DraftPerson {
  /** Stable while editing; the saved id for someone already saved. */
  key: string
  /** Sent back on an edit, so they keep their tick and look. */
  id?: string
  name: string
  /** Their animal in this split, sent with the split so it stays the one shown here. */
  avatar: AvatarChoice
}

export interface DraftDish {
  key: string
  name: string
  price: string
  /** Who had it, by DraftPerson.key. */
  had: string[]
  /** Shared by everyone in the split (the Other fix-up): someone added later has it too, until it's changed by hand. */
  everyone?: boolean
}

/** A charge with its own switch. Off is stored as 0; its rate is kept, so turning it back on never means 0%. */
export interface Charge {
  on: boolean
  bps: number
}

export interface QuickDraft {
  title: string
  place: string
  spentOn: string
  dishes: DraftDish[]
  service: Charge
  gst: Charge
  /** people[0] is you. */
  people: DraftPerson[]
  payerKey: string
  /** A scanned receipt's total, as typed (editable); null when there was no scan, or it showed none. */
  receiptTotal: string | null
}

const money = (cents: number) => formatMoney(cents, 'SGD')

let nextKey = 1
const newKey = (prefix: string) => `${prefix}${nextKey++}`
export const emptyDish = (): DraftDish => ({ key: newKey('d'), name: '', price: '', had: [] })

/** Adds someone by name, with a look nobody else in the split has. A dish shared by everyone is theirs too. */
export function addPerson(d: QuickDraft, name: string): QuickDraft {
  const key = newKey('p')
  const avatar = firstFreeAvatar(defaultAvatar(key), d.people.map((p) => p.avatar))
  return {
    ...d,
    people: [...d.people, { key, name, avatar }],
    dishes: d.dishes.map((it) => (it.everyone ? { ...it, had: [...it.had, key] } : it)),
  }
}

/** Takes someone out, and off every dish; if they paid, you did instead. */
export function removePerson(d: QuickDraft, key: string): QuickDraft {
  return {
    ...d,
    people: d.people.filter((p) => p.key !== key),
    dishes: d.dishes.map((it) => ({ ...it, had: it.had.filter((k) => k !== key) })),
    payerKey: d.payerKey === key ? d.people[0]!.key : d.payerKey,
  }
}

/** A fresh split: you (on your profile look) paid, both SG charges on. */
export function newQuickDraft(myName: string, today: string, myLook: AvatarChoice): QuickDraft {
  const me: DraftPerson = { key: newKey('p'), name: myName, avatar: myLook }
  return {
    title: '',
    place: '',
    spentOn: today,
    dishes: [emptyDish()],
    service: { on: true, bps: SG_PRESET.serviceChargeBps },
    gst: { on: true, bps: SG_PRESET.gstBps },
    people: [me],
    payerKey: me.key,
    receiptTotal: null,
  }
}

/** A charge as saved: on if it was more than 0%, else off at the SG rate. */
const chargeFrom = (bps: number, sgBps: number): Charge => (bps > 0 ? { on: true, bps } : { on: false, bps: sgBps })

/** The draft for editing a saved split, exactly as saved. */
export function draftFromSplit(s: QuickSplitDTO): QuickDraft {
  const people = s.people.map((p) => ({ key: p.id, id: p.id, name: p.name, avatar: p.avatar }))
  return {
    title: s.title,
    place: s.place ?? '',
    spentOn: s.spentOn,
    dishes: s.items.map((it) => ({ key: newKey('d'), name: it.name, price: centsToInput(it.amountCents), had: it.personIds })),
    service: chargeFrom(s.serviceChargeBps, SG_PRESET.serviceChargeBps),
    gst: chargeFrom(s.gstBps, SG_PRESET.gstBps),
    people,
    payerKey: s.payerId,
    receiptTotal: null,
  }
}

/**
 * A scanned receipt fills in the dishes (nobody assigned yet). Each charge is on only if the receipt has it, at the
 * receipt's rate; one it lacks is off, at the SG rate for when it is turned on. When the prices already include the
 * charges (receiptChargesIncluded), both start off, keeping the receipt's rates for turning on by hand. Its total,
 * when it shows one, is kept to check the dishes against (see totalCheck).
 */
export function applyScan(d: QuickDraft, scan: ReceiptScanResult): QuickDraft {
  const service = chargeFrom(scan.serviceChargeBps ?? 0, SG_PRESET.serviceChargeBps)
  const gst = chargeFrom(scan.gstBps ?? 0, SG_PRESET.gstBps)
  const included = receiptChargesIncluded(scan)
  return {
    ...d,
    dishes: scan.items.map((it) => ({ ...emptyDish(), name: it.name, price: centsToInput(it.amountCents) })),
    service: included ? { ...service, on: false } : service,
    gst: included ? { ...gst, on: false } : gst,
    receiptTotal: scan.totalCents === null ? null : centsToInput(scan.totalCents),
  }
}

/** Whether something typed would be replaced by a scan. */
export const hasTypedDishes = (d: QuickDraft) => d.dishes.some((it) => it.name.trim() !== '' || it.price.trim() !== '')

/** The rates as saved: 0 for a charge that is off. */
export const ratesOf = (d: QuickDraft) => ({ serviceChargeBps: d.service.on ? d.service.bps : 0, gstBps: d.gst.on ? d.gst.bps : 0 })

/** The dishes with a usable price, in cents. */
const pricedDishes = (d: QuickDraft) =>
  d.dishes.flatMap((it) => {
    const cents = parseAmount(it.price)
    return cents !== null && cents >= 1 ? [{ ...it, name: it.name.trim(), cents }] : []
  })

/** The bill so far (dishes, charges, total), or null before any dish has a price. Nobody needs to be assigned. */
export function billSoFar(d: QuickDraft): Pick<QuickSplitBreakdown, 'subtotalCents' | 'serviceChargeCents' | 'gstCents' | 'totalCents'> | null {
  const priced = pricedDishes(d)
  if (!priced.length) return null
  const { people: _people, ...bill } = quickSplitBreakdown({
    people: [{ id: 'all', isPayer: true }],
    items: priced.map((it) => ({ name: it.name, amountCents: it.cents, personIds: ['all'] })),
    ...ratesOf(d),
  })
  return bill
}

/** Everyone's totals by person key, once every dish has a price and someone who had it; else null. */
export function liveTotals(d: QuickDraft): QuickSplitBreakdown | 'too_small' | null {
  const priced = pricedDishes(d)
  if (!priced.length || priced.length !== d.dishes.length || priced.some((it) => it.had.length === 0)) return null
  try {
    return quickSplitBreakdown({
      people: d.people.map((p) => ({ id: p.key, isPayer: p.key === d.payerKey })),
      items: priced.map((it) => ({ name: it.name, amountCents: it.cents, personIds: it.had })),
      ...ratesOf(d),
    })
  } catch (err) {
    if (err instanceof SplitError) return 'too_small'
    throw err
  }
}

/** The receipt total as cents, null when blank or there is none; 'invalid' when it isn't an amount. */
function receiptTarget(d: QuickDraft): number | null | 'invalid' {
  if (d.receiptTotal === null || d.receiptTotal.trim() === '') return null
  const cents = parseAmount(d.receiptTotal)
  return cents === null || cents < 1 ? 'invalid' : cents
}

/**
 * Whether the dishes (with the charges) add up to the scanned receipt's total, within 2 cents: null when they do,
 * or when there is no total to check; otherwise the one line that says how far off they are, and the Other fix-up.
 */
export function totalCheck(d: QuickDraft): TotalCheck | null {
  const target = receiptTarget(d)
  const subtotal = pricedDishes(d).reduce((sum, it) => sum + it.cents, 0)
  if (target === null || target === 'invalid' || subtotal === 0) return null
  return checkTotal(subtotal, ratesOf(d), target, money)
}

/**
 * Adds an "Other" dish, shared by everyone in the split (people added later too), that makes up what the dishes are
 * short of the receipt's total. Its price is before the charges (see otherLine). Untouched blank rows are dropped.
 */
export function addOtherDish(d: QuickDraft): QuickDraft {
  const target = receiptTarget(d)
  const subtotal = pricedDishes(d).reduce((sum, it) => sum + it.cents, 0)
  const other = typeof target === 'number' && subtotal > 0 ? otherLine(subtotal, ratesOf(d), target) : null
  if (!other) return d
  const kept = d.dishes.filter((it) => it.name.trim() !== '' || it.price.trim() !== '')
  const dish: DraftDish = { ...emptyDish(), name: 'Other', price: centsToInput(other.priceCents), had: d.people.map((p) => p.key), everyone: true }
  return { ...d, dishes: [...kept, dish] }
}

/** Why the bill step isn't done yet, or null. It never goes on with dishes that fall short of the receipt's total. */
export function billProblem(d: QuickDraft): string | null {
  if (!d.title.trim()) return "What's it for? Give it a title, like Team lunch."
  if (d.title.trim().length > 50) return 'Keep the title to 50 characters or fewer.'
  if (d.dishes.some((it) => it.price.trim() !== '' && parseAmount(it.price) === null)) return 'Check the prices: use amounts like 4.50.'
  if (d.dishes.some((it) => !it.name.trim() || !(parseAmount(it.price) ?? 0))) return 'Give every dish a name and a price.'
  if (receiptTarget(d) === 'invalid') return `Check the receipt total: use an amount like ${centsToInput(billSoFar(d)?.totalCents ?? 0)}.`
  return totalCheck(d)?.message ?? null
}

/** Why the people step isn't done yet, or null. */
export function peopleProblem(d: QuickDraft): string | null {
  if (parseMemberName(d.people[0]!.name) === null) return 'Your name on the card: up to 24 characters, with no emoji.'
  if (d.people.length < 2) return 'Add at least one person to split with.'
  return null
}

/** The request body, or why it can't be saved yet. */
export function toInput(d: QuickDraft): { input: QuickSplitInput } | { problem: string } {
  if (d.dishes.some((it) => it.had.length === 0)) return { problem: 'Tap who had each dish.' }
  const index = new Map(d.people.map((p, i) => [p.key, i]))
  const parsed = QuickSplitInput.safeParse({
    title: d.title,
    place: d.place,
    spentOn: d.spentOn,
    ...ratesOf(d),
    people: d.people.map((p) => ({ ...(p.id && { id: p.id }), name: p.name, avatar: p.avatar, isPayer: p.key === d.payerKey })),
    items: pricedDishes(d).map((it) => ({ name: it.name, amountCents: it.cents, personIndexes: it.had.map((k) => index.get(k)!).sort((a, b) => a - b) })),
  })
  return parsed.success ? { input: parsed.data } : { problem: parsed.error.issues[0]?.message ?? 'Check the split.' }
}
