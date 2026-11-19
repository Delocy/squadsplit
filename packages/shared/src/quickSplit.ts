import { z } from 'zod'
import { AvatarChoice } from './avatar'
import { itemizedTotal, splitItemized } from './itemized'
import { distributeEqual, SplitError, type Cents, type Currency } from './money'
import { isRealDate, MemberName } from './schemas'

// Quick split: one restaurant bill, split with people who have no accounts, outside any group. The payer gets a
// share card and a public link where each guest ticks "I've paid". Totals are never stored: they are worked out
// here, from the dishes, so the API, the card and the public page always agree to the cent.

export const QUICK_SPLIT_MIN_PEOPLE = 2
export const QUICK_SPLIT_MAX_PEOPLE = 20
export const QUICK_SPLIT_MAX_ITEMS = 50
/** A share link stops working this many days after the split is created. */
export const QUICK_SPLIT_LINK_DAYS = 60
/** Ticks and unticks a share link takes per hour, from everyone together. */
export const QUICK_SPLIT_TICKS_PER_HOUR = 60

const MAX_CENTS = 100_000_000
const bps = z.number().int().min(0).max(3000)

/** One person in a quick split. `id` is sent for someone already saved (an edit), so they keep their tick and look. */
const QuickSplitPersonInput = z.object({
  id: z.string().min(1).optional(),
  name: MemberName,
  avatar: AvatarChoice.optional(),
  isPayer: z.boolean(),
})

/** A dish, and who had it, by their place in `people`. A shared dish is split evenly. */
const QuickSplitItemInput = z.object({
  name: z.string().trim().min(1).max(60),
  amountCents: z.number().int().min(1).max(MAX_CENTS),
  personIndexes: z.array(z.number().int().min(0)).min(1),
})

/**
 * Body of `POST /quick-splits` and `PUT /quick-splits/:id` (a full replace). `people[0]` is you, the owner: your row
 * starts on your profile look. Exactly one person paid; everyone else needs at least one dish.
 */
export const QuickSplitInput = z
  .object({
    title: z.string().trim().min(1).max(50),
    place: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((s) => s || null),
    spentOn: z.string().refine(isRealDate, { message: 'Must be a valid YYYY-MM-DD date' }),
    serviceChargeBps: bps,
    gstBps: bps,
    people: z.array(QuickSplitPersonInput).min(QUICK_SPLIT_MIN_PEOPLE).max(QUICK_SPLIT_MAX_PEOPLE),
    items: z.array(QuickSplitItemInput).min(1).max(QUICK_SPLIT_MAX_ITEMS),
  })
  .superRefine((v, ctx) => {
    const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const onePayer = v.people.filter((p) => p.isPayer).length === 1
    if (!onePayer) fail(['people'], 'Pick who paid.')
    const names = v.people.map((p) => p.name.toLowerCase())
    if (new Set(names).size !== names.length) fail(['people'], 'Everyone needs a different name.')
    const ids = v.people.flatMap((p) => (p.id === undefined ? [] : [p.id]))
    if (new Set(ids).size !== ids.length) fail(['people'], 'A person can only be in the split once.')
    const badItem = v.items.findIndex(
      (it) => it.personIndexes.some((i) => i >= v.people.length) || new Set(it.personIndexes).size !== it.personIndexes.length,
    )
    if (badItem !== -1) return fail(['items', badItem, 'personIndexes'], 'Pick who had each dish.')
    const hadSomething = new Set(v.items.flatMap((it) => it.personIndexes))
    if (v.people.some((p, i) => !p.isPayer && !hadSomething.has(i))) fail(['items'], 'Everyone but the payer needs at least one dish.')
    // The money checks need sound dishes; zod still runs this when a dish failed its own checks.
    const soundDishes = v.items.length > 0 && v.items.every((it) => it.personIndexes.length > 0 && QuickSplitItemInput.safeParse(it).success)
    if (!onePayer || !soundDishes) return
    const bill = billOfInput(v)
    const total = itemizedTotal({ items: v.items.map((it) => ({ ...it, userIds: [] })), serviceChargeBps: v.serviceChargeBps, gstBps: v.gstBps })
    if (total > MAX_CENTS) {
      return fail(['items'], 'Keep the bill to $1,000,000.00 or less.')
    }
    const tooSmall = "That's too small to split between that many people."
    // A dish of fewer cents than the people sharing it would show someone a 0¢ part of it.
    const crumb = v.items.findIndex((it) => it.amountCents < it.personIndexes.length)
    if (crumb !== -1) return fail(['items', crumb, 'amountCents'], tooSmall)
    try {
      quickSplitBreakdown(bill)
    } catch (err) {
      if (!(err instanceof SplitError)) throw err
      fail(['items'], tooSmall)
    }
  })
export type QuickSplitInput = z.infer<typeof QuickSplitInput>

/** Body of `PATCH /quick-splits/:id/people/:personId` and `POST /s/:token/people/:personId/paid`. */
export const MarkPaidInput = z.object({ paid: z.boolean() })
export type MarkPaidInput = z.infer<typeof MarkPaidInput>

/** What the totals are worked out from: who's in (and who paid), the dishes, and the charges. */
export interface QuickSplitBill {
  people: { id: string; isPayer: boolean }[]
  items: { name: string; amountCents: Cents; personIds: string[] }[]
  serviceChargeBps: number
  gstBps: number
}

/** A person's part of one dish: the whole dish, or an even share of it ("Satay ÷3"). */
export interface QuickSplitDish {
  name: string
  shareCents: Cents
  /** How many people shared it. */
  sharedBy: number
}

export interface QuickSplitBreakdown {
  subtotalCents: Cents
  serviceChargeCents: Cents
  gstCents: Cents
  totalCents: Cents
  /** By person id. Someone who had nothing has a total of 0 and no dishes. */
  people: Record<string, { totalCents: Cents; dishes: QuickSplitDish[] }>
}

/** The bill an input describes, with people standing in by their place in the list. */
function billOfInput(v: Pick<QuickSplitInput, 'people' | 'items' | 'serviceChargeBps' | 'gstBps'>): QuickSplitBill {
  const id = (i: number) => String(i)
  return {
    people: v.people.map((p, i) => ({ id: id(i), isPayer: p.isPayer })),
    items: v.items.map((it) => ({ name: it.name, amountCents: it.amountCents, personIds: it.personIndexes.map(id) })),
    serviceChargeBps: v.serviceChargeBps,
    gstBps: v.gstBps,
  }
}

/**
 * Each person's total and dishes, and the bill's charges, with the shared itemized maths: a shared dish is split
 * evenly (any spare cent to the payer if they shared it), and each total is that person's dishes plus the service
 * charge and GST, by the largest remainder, so the totals add up to the bill exactly. Throws SplitError when a dish
 * is too small to give everyone who shared it a cent.
 */
export function quickSplitBreakdown(bill: QuickSplitBill): QuickSplitBreakdown {
  // The shared maths breaks ties by id: a shared dish's spare cent and the largest remainder go to the id that sorts
  // first. People are relabelled by their place in the list ("00", "01", …), so ties go by entry order instead, the
  // same for the web's draft keys and the server's UUIDs, and the preview matches the saved split to the cent.
  const label = new Map(bill.people.map((p, i) => [p.id, String(i).padStart(2, '0')]))
  const as = (id: string) => label.get(id) ?? id
  const payer = as(bill.people.find((p) => p.isPayer)?.id ?? '')
  const items = bill.items.map((it) => ({ name: it.name, amountCents: it.amountCents, userIds: it.personIds.map(as) }))
  const charges = { serviceChargeBps: bill.serviceChargeBps, gstBps: bill.gstBps }
  const totals = splitItemized({ items, ...charges }, payer)
  const subtotalCents = items.reduce((sum, it) => sum + it.amountCents, 0)
  const totalCents = itemizedTotal({ items, ...charges })
  const serviceChargeCents = itemizedTotal({ items, serviceChargeBps: charges.serviceChargeBps, gstBps: 0 }) - subtotalCents

  const people: QuickSplitBreakdown['people'] = {}
  for (const p of bill.people) people[p.id] = { totalCents: totals[as(p.id)] ?? 0, dishes: [] }
  const byLabel = new Map(bill.people.map((p) => [as(p.id), people[p.id]!]))
  for (const it of items) {
    for (const [who, shareCents] of Object.entries(distributeEqual(it.amountCents, it.userIds, payer))) {
      byLabel.get(who)?.dishes.push({ name: it.name, shareCents, sharedBy: it.userIds.length })
    }
  }
  return { subtotalCents, serviceChargeCents, gstCents: totalCents - subtotalCents - serviceChargeCents, totalCents, people }
}

// ---- DTOs (types only) ----

export type PaidMarkedBy = 'guest' | 'payer'
/** A share link is 'on' until it is stopped or expires. */
export type ShareLinkState = 'on' | 'off'

/** A person as the owner sees them. The payer is never unpaid: their `paidAt` is null and they show as the one who paid. */
export interface QuickSplitPersonDTO {
  id: string
  name: string
  avatar: AvatarChoice
  isPayer: boolean
  totalCents: Cents
  dishes: QuickSplitDish[]
  paidAt: string | null
  paidMarkedBy: PaidMarkedBy | null
}

export interface QuickSplitItemDTO { id: string; name: string; amountCents: Cents; personIds: string[] }

/** The owner's view of the share link. */
export interface QuickSplitShareDTO { token: string; expiresAt: string; revokedAt: string | null; state: ShareLinkState }

/** `GET /quick-splits/:id` and friends (owner only). `people` in the order they were entered; `people[0]` is you. */
export interface QuickSplitDTO {
  id: string
  title: string
  place: string | null
  spentOn: string
  currency: Currency
  serviceChargeBps: number
  gstBps: number
  subtotalCents: Cents
  serviceChargeCents: Cents
  gstCents: Cents
  totalCents: Cents
  payerId: string
  people: QuickSplitPersonDTO[]
  items: QuickSplitItemDTO[]
  share: QuickSplitShareDTO
  createdAt: string
  updatedAt: string
}

/**
 * A row of `GET /quick-splits` (newest first). `paidCount` counts the payer and everyone ticked. `names` is everyone
 * in the order they were entered, `names[0]` being you.
 */
export interface QuickSplitSummaryDTO {
  id: string
  title: string
  place: string | null
  spentOn: string
  currency: Currency
  totalCents: Cents
  paidCount: number
  peopleCount: number
  link: ShareLinkState
  names: string[]
  createdAt: string
}

/** A person on the public share page: a first name and amounts, never an account. */
export interface PublicQuickSplitPersonDTO {
  id: string
  name: string
  avatar: AvatarChoice
  dishes: QuickSplitDish[]
  totalCents: Cents
  paidAt: string | null
  paidMarkedBy: PaidMarkedBy | null
}

/** `GET /s/:token`, for anyone with the link: names and amounts only, no user ids, owner, profile or token. */
export interface PublicQuickSplitDTO {
  title: string
  place: string | null
  spentOn: string
  currency: Currency
  serviceChargeBps: number
  gstBps: number
  subtotalCents: Cents
  serviceChargeCents: Cents
  gstCents: Cents
  totalCents: Cents
  payerId: string
  payerName: string
  people: PublicQuickSplitPersonDTO[]
}
