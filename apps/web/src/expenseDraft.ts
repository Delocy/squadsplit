import {
  CreateExpenseInput,
  formatMoney,
  itemizedTotal,
  SG_PRESET,
  splitEqual,
  SplitError,
  splitItemized,
  type BillItem,
  type Category,
  type Currency,
  type ExpenseDTO,
  type ReceiptScanResult,
} from '@squadsplit/shared'

// The add/edit expense form's state and rules, kept apart from the React code.
// Amounts are typed as text and only ever become integer cents here; no float touches money.

export type SplitMode = 'equal' | 'exact' | 'itemized'

export interface ItemDraft {
  key: number
  name: string
  price: string
  userIds: string[]
}

export interface ExpenseDraft {
  description: string
  amount: string
  category: Category
  paidBy: string
  spentOn: string
  mode: SplitMode
  /** equal: who shares it */
  participantIds: string[]
  /** exact: each person's amount as typed */
  exact: Record<string, string>
  /** itemized */
  items: ItemDraft[]
  /** Whether the bill's charges (below) are added on top of the items. */
  restaurantBill: boolean
  /** The service charge and GST rates the toggle adds: Singapore's 10% + 9%, or a scanned receipt's or saved expense's own. */
  charges: BillCharges
}

export interface BillCharges {
  serviceChargeBps: number
  gstBps: number
}

/** Whether the charges are the SG restaurant bill: 10% service charge, then 9% GST. */
export const isSgCharges = (c: BillCharges) => c.serviceChargeBps === SG_PRESET.serviceChargeBps && c.gstBps === SG_PRESET.gstBps

const percent = (bps: number) => `${bps / 100}%`

/** "10% service charge, then 9% GST", "9% GST" or "10% service charge". */
export function chargesHint(c: BillCharges): string {
  const parts = [c.serviceChargeBps > 0 && `${percent(c.serviceChargeBps)} service charge`, c.gstBps > 0 && `${percent(c.gstBps)} GST`]
  return parts.filter(Boolean).join(', then ')
}

/** "12", "12.5", "12.50" or ".5" → cents. Anything else (including more than 2 decimals) → null. */
export function parseAmount(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(text.trim())
  if (!m || (m[1] === '' && !m[2])) return null
  return Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** cents → "12.50", for filling the form in. */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

let nextItemKey = 1
export const emptyItem = (): ItemDraft => ({ key: nextItemKey++, name: '', price: '', userIds: [] })

/** A fresh form: you paid, split equally between everyone. */
export function newDraft(me: string, activeIds: string[], today: string): ExpenseDraft {
  return {
    description: '',
    amount: '',
    category: '🍕',
    paidBy: activeIds.includes(me) ? me : (activeIds[0] ?? ''),
    spentOn: today,
    mode: 'equal',
    participantIds: activeIds,
    exact: {},
    items: [emptyItem()],
    // Only used in By item mode, where it starts on (the playground default); the user can switch it off.
    restaurantBill: true,
    charges: { ...SG_PRESET },
  }
}

/**
 * The form filled in from a saved expense, exactly as stored. Expenses that involve someone who has left
 * never get here: the form refuses them (see formerMemberIn), so nothing is silently re-split.
 */
export function draftFromExpense(e: ExpenseDTO, activeIds: string[]): ExpenseDraft {
  return {
    description: e.description,
    amount: centsToInput(e.amountCents),
    category: e.category,
    paidBy: e.paidBy,
    spentOn: e.spentOn,
    mode: e.splitType,
    participantIds: e.splitType === 'equal' ? e.shares.map((s) => s.userId) : activeIds,
    exact: e.splitType === 'exact' ? Object.fromEntries(e.shares.map((s) => [s.userId, centsToInput(s.amountCents)])) : {},
    items: e.items?.length
      ? e.items.map((it) => ({ ...emptyItem(), name: it.name, price: centsToInput(it.amountCents), userIds: it.userIds }))
      : [emptyItem()],
    // An itemized expense keeps what was saved, rates included; any other starts on SG, in case it is switched to By item.
    ...(e.splitType === 'itemized' && ((e.serviceChargeBps ?? 0) > 0 || (e.gstBps ?? 0) > 0)
      ? { restaurantBill: true, charges: { serviceChargeBps: e.serviceChargeBps ?? 0, gstBps: e.gstBps ?? 0 } }
      : { restaurantBill: e.splitType !== 'itemized', charges: { ...SG_PRESET } }),
  }
}

/**
 * Whether the user has typed an amount, exact shares or item rows: what a scan would replace, so it asks first.
 * The description, date, category and payer are kept by a scan, so they don't count.
 */
export const hasEnteredAmounts = (d: ExpenseDraft) =>
  d.amount.trim() !== '' ||
  Object.values(d.exact).some((v) => v.trim() !== '') ||
  d.items.some((it) => it.name.trim() !== '' || it.price.trim() !== '')

/**
 * The form filled in from a scanned receipt: the split becomes By item and its items replace the rows (nobody
 * assigned yet). The receipt's own service charge and GST become the bill's charges (switched on), whatever their
 * rates, so the saved total is what the receipt adds up to; with no charges the toggle is off. The receipt's total,
 * when it shows one, becomes the amount too, for a switch back to Equally or Exact amounts.
 */
export function applyScan(d: ExpenseDraft, scan: ReceiptScanResult): ExpenseDraft {
  const charges = { serviceChargeBps: scan.serviceChargeBps ?? 0, gstBps: scan.gstBps ?? 0 }
  const hasCharges = charges.serviceChargeBps > 0 || charges.gstBps > 0
  return {
    ...d,
    mode: 'itemized',
    amount: scan.totalCents === null ? d.amount : centsToInput(scan.totalCents),
    items: scan.items.map((it) => ({ ...emptyItem(), name: it.name, price: centsToInput(it.amountCents) })),
    restaurantBill: hasCharges,
    charges: hasCharges ? charges : d.charges,
  }
}

export interface BillBreakdown {
  subtotal: number
  serviceCharge: number
  gst: number
  total: number
}

export interface DraftSummary {
  /** The expense total: the typed amount, or the itemized bill total. */
  amountCents: number | null
  /** Each person's share, for the preview line; null when it can't be worked out yet. */
  shares: Record<string, number> | null
  /** The amount is too small to give everyone at least a cent. */
  tooSmall: boolean
  /** exact mode: amount minus what has been assigned (negative when over). */
  leftToAssign: number | null
  /** itemized mode */
  bill: BillBreakdown | null
  /** Why the expense can't be saved yet, in plain words; null when it can. */
  problem: string | null
  /** The request body, when there is no problem. */
  input: CreateExpenseInput | null
}

const MAX_CENTS = 100_000_000
const TOO_SMALL = "That's too small to split between that many people."

const tryShares = (f: () => Record<string, number>): Record<string, number> | 'too_small' => {
  try {
    return f()
  } catch (e) {
    if (e instanceof SplitError) return 'too_small'
    throw e
  }
}

/** Works out the totals, shares and anything still wrong with the draft. `activeIds` sets the order people are listed in. */
export function summarize(d: ExpenseDraft, activeIds: string[], currency: Currency): DraftSummary {
  const money = (c: number) => formatMoney(c, currency)
  const ordered = (ids: Iterable<string>) => {
    const set = new Set(ids)
    return activeIds.filter((id) => set.has(id))
  }
  const typed = parseAmount(d.amount)
  const typedAmount = typed !== null && typed >= 1 ? typed : null
  const out: DraftSummary = { amountCents: null, shares: null, tooSmall: false, leftToAssign: null, bill: null, problem: null, input: null }
  let split: CreateExpenseInput['split'] | null = null
  let splitProblem: string | null = null

  if (d.mode === 'equal') {
    out.amountCents = typedAmount
    const ids = ordered(d.participantIds)
    if (!ids.length) splitProblem = 'Pick at least one person to split with.'
    else if (typedAmount !== null) {
      const shares = tryShares(() => splitEqual(typedAmount, ids, d.paidBy))
      if (shares === 'too_small') {
        out.tooSmall = true
        splitProblem = TOO_SMALL
      } else {
        out.shares = shares
        split = { type: 'equal', participantIds: ids }
      }
    }
  } else if (d.mode === 'exact') {
    out.amountCents = typedAmount
    const entries = activeIds.filter((id) => (d.exact[id] ?? '').trim() !== '').map((id) => ({ userId: id, cents: parseAmount(d.exact[id]!) }))
    const shares = entries.filter((e) => e.cents !== null && e.cents > 0).map((e) => ({ userId: e.userId, amountCents: e.cents! }))
    const assigned = shares.reduce((sum, s) => sum + s.amountCents, 0)
    if (typedAmount !== null) out.leftToAssign = typedAmount - assigned
    if (entries.some((e) => e.cents === null)) splitProblem = 'Check the shares: use amounts like 4.50.'
    else if (!shares.length) splitProblem = 'Give at least one person a share.'
    else if (out.leftToAssign !== null && out.leftToAssign !== 0) {
      splitProblem = out.leftToAssign > 0 ? `${money(out.leftToAssign)} left to assign` : `${money(-out.leftToAssign)} too much assigned`
    } else {
      out.shares = Object.fromEntries(shares.map((s) => [s.userId, s.amountCents]))
      split = { type: 'exact', shares }
    }
  } else {
    const bps = d.restaurantBill ? d.charges : { serviceChargeBps: 0, gstBps: 0 }
    const priced = d.items.map((it) => ({ ...it, cents: parseAmount(it.price) })).filter((it) => it.cents !== null && it.cents >= 1)
    if (priced.length) {
      const items: BillItem[] = priced.map((it) => ({ name: it.name.trim(), amountCents: it.cents!, userIds: ordered(it.userIds) }))
      const total = itemizedTotal({ items, ...bps })
      const withService = itemizedTotal({ items, serviceChargeBps: bps.serviceChargeBps, gstBps: 0 })
      const subtotal = items.reduce((sum, it) => sum + it.amountCents, 0)
      out.bill = { subtotal, serviceCharge: withService - subtotal, gst: total - withService, total }
      out.amountCents = total
      if (items.every((it) => it.userIds.length)) {
        const shares = tryShares(() => splitItemized({ items, ...bps }, d.paidBy))
        if (shares === 'too_small') {
          out.tooSmall = true
          splitProblem = TOO_SMALL
        } else out.shares = shares
      }
      if (priced.length !== d.items.length || items.some((it) => !it.userIds.length)) {
        splitProblem = 'Give every item a price and at least one person.'
      } else if (items.some((it) => !it.name)) splitProblem = 'Give every item a name.'
      else if (out.shares) split = { type: 'itemized', items, ...bps }
    } else splitProblem = 'Add at least one item with a price.'
  }

  if (!d.description.trim()) out.problem = 'Add a description.'
  else if (d.mode !== 'itemized' && typedAmount === null) out.problem = `The amount needs to be at least ${money(1)}.`
  else if (out.amountCents !== null && out.amountCents > MAX_CENTS) out.problem = `Keep it to ${money(MAX_CENTS)} or less.`
  else if (!activeIds.includes(d.paidBy)) out.problem = 'Pick who paid.'
  else if (splitProblem) out.problem = splitProblem
  else {
    const parsed = CreateExpenseInput.safeParse({
      description: d.description,
      amountCents: out.amountCents,
      paidBy: d.paidBy,
      category: d.category,
      spentOn: d.spentOn,
      currency,
      split,
    })
    if (parsed.success) out.input = parsed.data
    else out.problem = parsed.error.issues[0]?.message ?? 'Check the expense details.'
  }
  return out
}
